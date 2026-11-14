-- The weekly triage (PRD E6-S5) becomes a job the worker can run: triage.run, queued every Monday after the FDIC check and a scoring run.
-- The list holds every existing kind plus the new one. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract'));
