-- A deletion request (PRD E7-S3) must remove a person from every record, and two append-only logs can name them: a free-text note on a
-- guard event in touches.jsonl, and (by design never, but checked) outcomes.jsonl. flush_uow() now takes `redactions` as well:
--   plan = { docs: [...], lines: [...], redactions: [{ path, old, new }] }
-- Each redaction finds the log lines equal to `old` and makes them `new`. It is a redaction and nothing else:
--   - only touches.jsonl and outcomes.jsonl; the audit log is never rewritten;
--   - `new` has exactly the keys of `old`, and every value that differs is the string "[removed]";
--   - type, accountId, institution, date, id and ref never change, so a reply or an opt-out keeps stopping the sequence, and an outcome
--     keeps its account and date.
-- A redaction whose line is no longer there (it changed since it was loaded) raises SQLSTATE 40001 and undoes the whole flush, like a
-- stale document. The reply now also says how many lines were redacted, so the client can tell this function from the old one.
-- Contains no data.
create or replace function public.flush_uow(plan jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; r jsonb; actor text; n int; written int := 0; appended int := 0; redacted int := 0;
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

  for r in select value from jsonb_array_elements(coalesce(plan -> 'redactions', '[]'::jsonb)) loop
    if coalesce(r ->> 'path', '') not in ('touches.jsonl', 'outcomes.jsonl') then
      raise exception 'Not allowed: only touches.jsonl and outcomes.jsonl lines can be redacted.' using errcode = '42501';
    end if;
    if jsonb_typeof(r -> 'old') is distinct from 'object' or jsonb_typeof(r -> 'new') is distinct from 'object'
       or (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(r -> 'old') k) is distinct from (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(r -> 'new') k)
       or exists (select 1 from jsonb_each(r -> 'old') o
                   where o.value is distinct from (r -> 'new' -> o.key)
                     and ((r -> 'new' -> o.key) is distinct from '"[removed]"'::jsonb or o.key in ('type', 'accountId', 'institution', 'date', 'id', 'ref'))) then
      raise exception 'Not allowed: a redaction may only replace a value with "[removed]", never a protected key.' using errcode = '42501';
    end if;
    update log_lines set line = r -> 'new' where path = r ->> 'path' and line = r -> 'old';
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'Conflict: a line of % changed since it was loaded.', r ->> 'path' using errcode = '40001';
    end if;
    redacted := redacted + n;
  end loop;

  insert into log_lines (path, line, by)
  select l ->> 'path', l -> 'line', actor from jsonb_array_elements(coalesce(plan -> 'lines', '[]'::jsonb)) l;
  get diagnostics appended = row_count;

  return jsonb_build_object('written', written, 'appended', appended, 'redacted', redacted);
end $$;

-- Replacing a function keeps its grants; they are set again here so this file says on its own who may call it.
revoke execute on function public.flush_uow(jsonb) from public, anon;
grant execute on function public.flush_uow(jsonb) to authenticated, service_role;
