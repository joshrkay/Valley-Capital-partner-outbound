-- The worker (and operators) act as service_role through PostgREST, which inherits the authenticator's 8 s statement_timeout.
-- A weekly scoring run saves the whole candidate list in one unit of work (flush_uow), which can take longer than 8 s, so it
-- failed with "canceling statement due to statement timeout". Give service_role its own, longer limit; the principals' web app
-- runs as authenticated and keeps its 8 s. Reload PostgREST so it picks the role setting up.
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';
