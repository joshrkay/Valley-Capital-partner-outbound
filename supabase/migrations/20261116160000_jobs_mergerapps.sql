-- Merger applications (PRD next-five E18-S3) become a job the worker can run: sources.mergerapps, which reads the Federal Reserve's
-- weekly H.2 release. The list holds every existing kind plus the new one. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'sources.enforcement', 'sources.mergerapps', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract'));
