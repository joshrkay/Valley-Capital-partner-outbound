-- The SEC filings listener (PRD E13-S1) becomes a job the worker can run. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'research.run', 'draft.run'));
