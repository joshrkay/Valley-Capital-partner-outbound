-- Valley Capital outbound platform: foundation (PRD E12-S2). For one firm's principals only. Contains no prospect data.
--
-- The engine's data folder becomes two tables: `documents` (its .json and text files, each with a version number) and `log_lines`
-- (its append-only .jsonl logs). The engine reads and writes them through a unit of work (src/uow.mjs): it loads what an action
-- needs, runs, and writes every change back through flush_uow() in one transaction. A document changed by someone else since it was
-- loaded makes the whole flush fail and change nothing. `candidates` is a projection of candidates/latest.json that flush_uow keeps
-- in step, so the web app never loads the whole file. `jobs` is the queue for long work (data pulls, scoring, research, drafting).
--
-- Access: every table has row-level security. A signed-in user whose email is an active principal may read. Nobody writes to a
-- table directly: every write goes through a function that checks the caller. The anonymous key can do nothing. The worker uses the
-- service role. Identity comes from the request's JWT claims (PostgREST sets request.jwt.claims), not from the client.

-- Who may use the platform. Rows are added by an operator with the service role, never from the app.
create table public.principals (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  name text not null,
  active boolean not null default true,
  added_at timestamptz not null default now()
);

create table public.documents (
  path text primary key check (path ~ '^[A-Za-z0-9_][A-Za-z0-9_./-]*$' and path !~ '\.\.' and path !~ '\.jsonl$'),
  kind text not null check (kind in ('json', 'text')),
  body jsonb,
  text text,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  check ((kind = 'json' and body is not null and text is null) or (kind = 'text' and text is not null and body is null))
);

create table public.log_lines (
  id bigserial primary key,
  path text not null check (path ~ '^[A-Za-z0-9_][A-Za-z0-9_./-]*\.jsonl$' and path !~ '\.\.'),
  line jsonb not null,
  at timestamptz not null default now(),
  by text not null
);
create index log_lines_path_id on public.log_lines (path, id);

-- One row per candidate, from the latest scoring run. The columns are what the list filters and sorts on; `item` is the whole record.
create table public.candidates (
  key text primary key,
  run_id text not null,
  provisional boolean not null default false,
  period text,
  tier text check (tier in ('A', 'B')),
  score numeric,
  distress numeric,
  fit numeric,
  timing numeric,
  name text not null,
  metros text[] not null default '{}',
  sectors text[] not null default '{}',
  filtered boolean not null default false,
  card text,
  item jsonb not null,
  updated_at timestamptz not null default now()
);
create index candidates_tier_score on public.candidates (tier, score desc);

create table public.jobs (
  id bigserial primary key,
  kind text not null check (kind in ('sources.fdic', 'score.run', 'research.run', 'draft.run')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  requested_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb
);
create index jobs_status_id on public.jobs (status, id);

-- ---- Who is calling ---------------------------------------------------------------------------------------------------------------
create function public.jwt_claims() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function public.is_service() returns boolean language sql stable as $$
  select coalesce(public.jwt_claims() ->> 'role', '') = 'service_role'
$$;

create function public.caller_email() returns text language sql stable as $$
  select lower(coalesce(public.jwt_claims() ->> 'email', ''))
$$;

create function public.is_principal() returns boolean language sql stable security definer set search_path = public as $$
  select public.caller_email() <> '' and exists (select 1 from public.principals p where p.active and p.email = public.caller_email())
$$;

-- ---- The candidate projection -----------------------------------------------------------------------------------------------------
create function public.project_candidates(latest jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from candidates c
   where not exists (select 1 from jsonb_array_elements(coalesce(latest -> 'items', '[]'::jsonb)) i where i ->> 'key' = c.key);
  insert into candidates (key, run_id, provisional, period, tier, score, distress, fit, timing, name, metros, sectors, filtered, card, item, updated_at)
  select i ->> 'key', coalesce(latest ->> 'runId', ''), coalesce((latest ->> 'provisional')::boolean, false), i ->> 'latestRepdte',
         nullif(i ->> 'tier', ''), (i ->> 'score')::numeric,
         (i -> 'axes' ->> 'distress')::numeric, (i -> 'axes' ->> 'fit')::numeric, (i -> 'axes' ->> 'timing')::numeric,
         coalesce(i ->> 'name', i ->> 'key'),
         coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(i -> 'metros') = 'array' then i -> 'metros' else '[]'::jsonb end)), '{}'),
         coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(i -> 'sectors') = 'array' then i -> 'sectors' else '[]'::jsonb end)), '{}'),
         jsonb_array_length(case when jsonb_typeof(i -> 'filtersFailed') = 'array' then i -> 'filtersFailed' else '[]'::jsonb end) > 0,
         i -> 'card' ->> 'text', i, now()
    from jsonb_array_elements(coalesce(latest -> 'items', '[]'::jsonb)) i
  on conflict (key) do update set run_id = excluded.run_id, provisional = excluded.provisional, period = excluded.period, tier = excluded.tier,
    score = excluded.score, distress = excluded.distress, fit = excluded.fit, timing = excluded.timing, name = excluded.name,
    metros = excluded.metros, sectors = excluded.sectors, filtered = excluded.filtered, card = excluded.card, item = excluded.item,
    updated_at = excluded.updated_at;
end $$;

-- ---- Writing a unit of work -------------------------------------------------------------------------------------------------------
-- plan = { docs: [{ path, kind: 'json'|'text', body | text, baseVersion }], lines: [{ path, line }] }
-- baseVersion is the version the document had when it was loaded (0: it did not exist). If any document has moved on since, the
-- whole flush is undone and raises SQLSTATE 40001 with the path; the caller reloads and tries again, or reports it.
create function public.flush_uow(plan jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; actor text; n int; written int := 0; appended int := 0;
begin
  if not (public.is_service() or public.is_principal()) then
    raise exception 'Not allowed: only an active principal or the service role may write.' using errcode = '42501';
  end if;
  actor := case when public.is_service() then 'service' else public.caller_email() end;

  for d in select value from jsonb_array_elements(coalesce(plan -> 'docs', '[]'::jsonb)) loop
    if coalesce((d ->> 'baseVersion')::bigint, 0) = 0 then
      begin
        insert into documents (path, kind, body, text, version, updated_by)
        values (d ->> 'path', d ->> 'kind', case when d ->> 'kind' = 'json' then d -> 'body' end, case when d ->> 'kind' = 'text' then d ->> 'text' end, 1, actor);
      exception when unique_violation then
        raise exception 'Conflict: % was created by someone else since it was loaded.', d ->> 'path' using errcode = '40001';
      end;
    else
      update documents
         set kind = d ->> 'kind', body = case when d ->> 'kind' = 'json' then d -> 'body' end, text = case when d ->> 'kind' = 'text' then d ->> 'text' end,
             version = version + 1, updated_at = now(), updated_by = actor
       where path = d ->> 'path' and version = (d ->> 'baseVersion')::bigint;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'Conflict: % changed since it was loaded.', d ->> 'path' using errcode = '40001';
      end if;
    end if;
    written := written + 1;
    if d ->> 'path' = 'candidates/latest.json' then perform public.project_candidates(d -> 'body'); end if;
  end loop;

  insert into log_lines (path, line, by)
  select l ->> 'path', l -> 'line', actor from jsonb_array_elements(coalesce(plan -> 'lines', '[]'::jsonb)) l;
  get diagnostics appended = row_count;

  return jsonb_build_object('written', written, 'appended', appended);
end $$;

-- ---- The job queue ----------------------------------------------------------------------------------------------------------------
create function public.enqueue_job(kind text, params jsonb default '{}'::jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare jid bigint;
begin
  if not (public.is_service() or public.is_principal()) then
    raise exception 'Not allowed: only an active principal or the service role may queue work.' using errcode = '42501';
  end if;
  insert into jobs (kind, params, requested_by) values (kind, coalesce(params, '{}'::jsonb), case when public.is_service() then 'service' else public.caller_email() end)
  returning id into jid;
  return jid;
end $$;

-- The worker takes the oldest queued job. Two workers never take the same one (skip locked).
create function public.claim_job() returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'Not allowed: only the worker may claim jobs.' using errcode = '42501'; end if;
  return query
    update jobs set status = 'running', started_at = now()
     where id = (select id from jobs where status = 'queued' order by id for update skip locked limit 1)
    returning *;
end $$;

create function public.finish_job(job_id bigint, ok boolean, result jsonb default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'Not allowed: only the worker may finish jobs.' using errcode = '42501'; end if;
  update jobs set status = case when ok then 'done' else 'failed' end, finished_at = now(), result = finish_job.result
   where id = job_id and status = 'running';
end $$;

-- ---- Access ----------------------------------------------------------------------------------------------------------------------
alter table public.principals enable row level security;
alter table public.documents enable row level security;
alter table public.log_lines enable row level security;
alter table public.candidates enable row level security;
alter table public.jobs enable row level security;

create policy principals_read on public.principals for select to authenticated using (public.is_principal());
create policy documents_read on public.documents for select to authenticated using (public.is_principal());
create policy log_lines_read on public.log_lines for select to authenticated using (public.is_principal());
create policy candidates_read on public.candidates for select to authenticated using (public.is_principal());
create policy jobs_read on public.jobs for select to authenticated using (public.is_principal());

revoke all on public.principals, public.documents, public.log_lines, public.candidates, public.jobs from anon, authenticated;
grant select on public.principals, public.documents, public.log_lines, public.candidates, public.jobs to authenticated;
revoke all on sequence public.log_lines_id_seq, public.jobs_id_seq from anon, authenticated;

-- Functions are executable by PUBLIC by default in Postgres, and Supabase also grants every new function to anon, authenticated and
-- service_role by default. Take all of that away, then grant back only what each caller needs. project_candidates gets no grant at
-- all: it runs only inside flush_uow, so no caller can rewrite the candidate table directly.
revoke execute on function public.jwt_claims(), public.is_service(), public.caller_email(), public.is_principal(),
  public.project_candidates(jsonb), public.flush_uow(jsonb), public.enqueue_job(text, jsonb), public.claim_job(),
  public.finish_job(bigint, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.jwt_claims(), public.is_service(), public.caller_email(), public.is_principal() to authenticated, service_role;
grant execute on function public.flush_uow(jsonb), public.enqueue_job(text, jsonb) to authenticated, service_role;
grant execute on function public.claim_job(), public.finish_job(bigint, boolean, jsonb) to service_role;
