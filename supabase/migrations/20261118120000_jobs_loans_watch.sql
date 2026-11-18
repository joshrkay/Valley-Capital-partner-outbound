-- The county watchers (docs/county-loans.md) become a job the worker can run: loans.watch, which reads every county source listed in
-- config.counties.watch (the first is Caldwell County, Texas: its posted notices of trustee's sale), queued weekly on Mondays. The list
-- holds every existing kind plus the new one. Contains no data.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'sources.enforcement', 'sources.mergerapps', 'loans.watch', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract'));
