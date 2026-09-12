-- ═══════════════════════════════════════════════════════════════════════════
-- PART 12: Test-room sessions — complete the legacy backend
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- What the database already had (legacy, kept working):
--   test_sessions(id, robot_id, status, ends_at, request_id, created_at)
--   start_test_session(p_request_id, p_robot_id) — both required, row return
--   get_server_time() — scalar TIMESTAMPTZ
-- What was missing (every call failed PGRST202):
--   orga sent start_test_session({p_robot_id}) — 1 arg never matched the
--     2-required-arg function → "couldn't find the function" on every scan.
--   get_active_sessions / end_test_session / get_my_active_session absent.
--   No started_at / arena_id / ended_at columns for what the UI renders.
--
-- This migration (all additive except the start overload, which keeps its
-- name + arg order + 2-arg callers working):
--   1. ADD started_at / arena_id / ended_at; backfill; close out expired rows
--      so the one-live-session-per-robot index builds cleanly.
--   2. Redefine start_test_session(p_request_id DEFAULT NULL, p_robot_id):
--      1-arg calls (orga scanner) and 2-arg calls (concurrency probe) both
--      match; returns the JSONB contract the UI reads; assigns least-loaded
--      of Test 1..8; replays dedupe; races return the winner as duplicate.
--   3. get_server_time() → {now} (participant reads data.now).
--   4. New: get_active_sessions(), get_my_active_session(), end_test_session().
-- Rules: one live session per robot, 5-minute slots, max 2 sessions per team
-- (lifetime quota — the 3rd attempt is rejected with an exhausted message).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.test_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.test_sessions ADD COLUMN IF NOT EXISTS arena_id TEXT;
ALTER TABLE public.test_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Backfill, then close out anything already expired so the partial index below
-- only ever sees genuinely live rows.
UPDATE public.test_sessions SET started_at = created_at WHERE started_at IS NULL;
UPDATE public.test_sessions
SET ended_at = ends_at
WHERE ended_at IS NULL AND ends_at <= now();

-- One live session per robot (ended/expired rows stay as history).
DROP INDEX IF EXISTS public.uq_live_test_session_robot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_test_session_robot
  ON public.test_sessions (robot_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_test_sessions_live
  ON public.test_sessions (started_at)
  WHERE ended_at IS NULL;

-- RPC-only access (same posture as processed_requests).
ALTER TABLE public.test_sessions ENABLE ROW LEVEL SECURITY;

-- ── 2. start_test_session (same name + arg order; p_request_id now optional) ─
-- Also drop the legacy (p_robot_id, p_request_id TEXT) overload: with two
-- overloads PostgREST cannot resolve 2-arg calls (PGRST203 ambiguity).
DROP FUNCTION IF EXISTS public.start_test_session(UUID, UUID);
DROP FUNCTION IF EXISTS public.start_test_session(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.start_test_session(
  p_request_id UUID DEFAULT NULL,
  p_robot_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_robot RECORD;
  v_existing RECORD;
  v_arena TEXT;
  v_row RECORD;
  v_used INT;
  v_arenas TEXT[] := ARRAY['Test 1','Test 2','Test 3','Test 4','Test 5','Test 6','Test 7','Test 8'];
BEGIN
  IF p_robot_id IS NULL THEN
    RAISE EXCEPTION 'Robot not specified';
  END IF;
  SELECT * INTO v_robot FROM public.robots WHERE id = p_robot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Robot not found';
  END IF;

  -- Replay guard: same request retried (double-scan / retry) → same session.
  -- NOTE: compared as text — legacy request_id columns were created as TEXT,
  -- so a direct uuid comparison raises "operator does not exist: text = uuid".
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.test_sessions WHERE request_id::text = p_request_id::text;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'status', 'success',
        'deduped', true,
        'session_id', v_existing.id,
        'robot_id', v_existing.robot_id,
        'robot_name', v_robot.name,
        'arena_id', v_existing.arena_id,
        'started_at', v_existing.started_at,
        'ends_at', v_existing.ends_at
      );
    END IF;
  END IF;

  -- Already live (other request) → return it as duplicate, never double-book.
  SELECT * INTO v_existing
  FROM public.test_sessions
  WHERE robot_id = p_robot_id AND ended_at IS NULL AND ends_at > now();
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'deduped', false,
      'session_id', v_existing.id,
      'robot_id', v_existing.robot_id,
      'robot_name', v_robot.name,
      'arena_id', v_existing.arena_id,
      'started_at', v_existing.started_at,
      'ends_at', v_existing.ends_at
    );
  END IF;

  -- Team quota: 2 test sessions per team, ever. Replays (above) still pass —
  -- only genuinely new sessions are rejected once the quota is exhausted.
  IF v_robot.team_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used
    FROM public.test_sessions s
    JOIN public.robots r ON r.id = s.robot_id
    WHERE r.team_id = v_robot.team_id;
  ELSE
    SELECT COUNT(*) INTO v_used
    FROM public.test_sessions
    WHERE robot_id = p_robot_id;
  END IF;
  IF v_used >= 2 THEN
    RAISE EXCEPTION 'Test sessions exhausted for this team (maximum 2) — no more testing allowed';
  END IF;

  -- Least-loaded test arena for the 5-minute slot.
  SELECT a INTO v_arena
  FROM unnest(v_arenas) AS a
  ORDER BY (
    SELECT COUNT(*) FROM public.test_sessions s
    WHERE s.arena_id = a AND s.ended_at IS NULL AND s.ends_at > now()
  ), a
  LIMIT 1;

  BEGIN
    INSERT INTO public.test_sessions
      (robot_id, arena_id, started_at, ends_at, request_id, status)
    VALUES (p_robot_id, v_arena, now(), now() + make_interval(mins => 5), p_request_id, 'ACTIVE')
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race with another scanner: return the winner's session.
    SELECT * INTO v_existing
    FROM public.test_sessions
    WHERE robot_id = p_robot_id AND ended_at IS NULL;
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'deduped', false,
      'session_id', v_existing.id,
      'robot_id', v_existing.robot_id,
      'robot_name', v_robot.name,
      'arena_id', v_existing.arena_id,
      'started_at', v_existing.started_at,
      'ends_at', v_existing.ends_at
    );
  END;

  RETURN jsonb_build_object(
    'status', 'success',
    'deduped', false,
    'session_id', v_row.id,
    'robot_id', v_row.robot_id,
    'robot_name', v_robot.name,
    'arena_id', v_row.arena_id,
    'started_at', v_row.started_at,
    'ends_at', v_row.ends_at
  );
END;
$$;

-- ── 3. get_server_time → {now} ──────────────────────────────────────────────
-- DROP first: the legacy version returns scalar TIMESTAMPTZ and
-- CREATE OR REPLACE cannot change a return type (42P13).
DROP FUNCTION IF EXISTS public.get_server_time();

CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object('now', now());
$$;

-- ── 4. Reads + end ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_sessions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(t ORDER BY t.started_at), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT s.id AS session_id, s.robot_id, r.name AS robot_name,
           s.arena_id, s.started_at, s.ends_at
    FROM public.test_sessions s
    JOIN public.robots r ON r.id = s.robot_id
    WHERE s.ended_at IS NULL AND s.ends_at > now()
  ) t;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_active_session()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_team UUID;
  v_row JSONB;
BEGIN
  SELECT team_id INTO v_team FROM public.profiles WHERE id = auth.uid();
  IF v_team IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'session_id', s.id,
    'robot_id', s.robot_id,
    'robot_name', r.name,
    'arena_id', s.arena_id,
    'started_at', s.started_at,
    'ends_at', s.ends_at
  ) INTO v_row
  FROM public.test_sessions s
  JOIN public.robots r ON r.id = s.robot_id
  WHERE s.ended_at IS NULL AND s.ends_at > now()
    AND r.team_id = v_team
  ORDER BY s.started_at DESC
  LIMIT 1;

  RETURN v_row;
END;
$$;

DROP FUNCTION IF EXISTS public.end_test_session(UUID);

CREATE OR REPLACE FUNCTION public.end_test_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.test_sessions
  SET ended_at = now(), status = 'ENDED'
  WHERE id = p_session_id AND ended_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Session not found or already ended';
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'session_id', p_session_id,
    'ended', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_sessions() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_active_session() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_test_session(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_test_session(UUID) TO anon, authenticated, service_role;
