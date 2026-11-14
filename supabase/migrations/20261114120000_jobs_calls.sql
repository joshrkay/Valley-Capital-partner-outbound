-- Call prep and outcome capture (PRD E15) become jobs the worker can run: the call brief (call.prep) and reading a principal's call
-- notes into a proposal (call.extract). The list holds every existing kind plus the two new ones. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'research.run', 'draft.run', 'call.prep', 'call.extract'));
