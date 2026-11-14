-- The FDIC loan-sale pull (PRD E16-S2) becomes a job the worker can run: sources.fdicsales, which records FDIC loan-sale announcements
-- and rebuilds the sale ledger. The list holds every existing kind plus the new one. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract'));
