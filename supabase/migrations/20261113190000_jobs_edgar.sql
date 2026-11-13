-- The CMBS loan-data pull (PRD E4-S2) becomes a job the worker can run. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'score.run', 'research.run', 'draft.run'));
