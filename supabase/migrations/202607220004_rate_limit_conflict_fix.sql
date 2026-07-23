-- 202607220004_rate_limit_conflict_fix.sql
-- Fix: rachandzach_consume_rate_limit raised SQLSTATE 42702 on every call.
-- Inside PL/pgSQL, the ON CONFLICT column target (key_hash, action,
-- window_start) is resolved against the identically named function
-- parameters and becomes ambiguous. Targeting the primary-key constraint by
-- name sidesteps column inference entirely. Found by the live cloud smoke
-- test on 2026-07-22; behavior is otherwise unchanged.
--
-- SHARED-PROJECT CONVENTION: this migration touches exactly one
-- rachandzach_ function. Per-object privileges are re-asserted below.

create or replace function public.rachandzach_consume_rate_limit(
  key_hash text,
  action text,
  attempt_limit int,
  window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_attempts int;
begin
  if attempt_limit is null or attempt_limit <= 0
     or window_seconds is null or window_seconds <= 0 then
    raise exception 'attempt_limit and window_seconds must be positive';
  end if;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / window_seconds) * window_seconds
  );
  insert into public.rachandzach_rate_limit_buckets as b (key_hash, action, window_start, attempts)
  values (rachandzach_consume_rate_limit.key_hash, rachandzach_consume_rate_limit.action, v_window_start, 1)
  on conflict on constraint rachandzach_rate_limit_buckets_pkey
  do update set attempts = b.attempts + 1
  returning b.attempts into v_attempts;
  return v_attempts <= attempt_limit;
end
$$;

revoke all on function public.rachandzach_consume_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.rachandzach_consume_rate_limit(text, text, int, int) to service_role;
