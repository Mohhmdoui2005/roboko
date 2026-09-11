-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: Phase 1 Qualification Engine — core schema + RPCs + trigger
-- RUN THIS FIRST in the Supabase SQL editor (before generate_phase1_matches.sql)
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop stale stubs first: Postgres cannot change a function's return type
-- via CREATE OR REPLACE (error 42P13).
DROP FUNCTION IF EXISTS public.increment_warning(UUID, UUID);
DROP FUNCTION IF EXISTS public.increment_warning();
DROP FUNCTION IF EXISTS public.submit_match_round(UUID, UUID, INT, INT, INT);
DROP FUNCTION IF EXISTS public.submit_match_round();

-- 1. Columns the jury workflow needs on matches (DB currently lacks them)
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS current_round INT DEFAULT 1;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS warnings_team1 INT DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS warnings_team2 INT DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS subphase INT DEFAULT 1;

-- match_rounds idempotency key (DB has match_id/round_number/team1_result/
-- team2_result; request_id may be missing)
ALTER TABLE public.match_rounds ADD COLUMN IF NOT EXISTS request_id UUID;
-- Null/draw rounds are a core Phase 1 rule (rounds 1-3 may be null/null;
-- round 4 unlocks when all three are null) → result columns must be nullable.
ALTER TABLE public.match_rounds ALTER COLUMN team1_result DROP NOT NULL;
ALTER TABLE public.match_rounds ALTER COLUMN team2_result DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_match_rounds_request_id'
  ) THEN
    CREATE UNIQUE INDEX uq_match_rounds_request_id
      ON public.match_rounds (request_id) WHERE request_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_match_rounds_match_round'
  ) THEN
    CREATE UNIQUE INDEX uq_match_rounds_match_round
      ON public.match_rounds (match_id, round_number);
  END IF;
END $$;

-- 2. Notifications table (Get Ready alerts)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id TEXT,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'GET_READY',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications' AND policyname = 'Anyone can read notifications'
  ) THEN
    CREATE POLICY "Anyone can read notifications"
      ON public.notifications FOR SELECT USING (true);
  END IF;
END $$;

-- Realtime optional (jury + participants poll, but leave the door open)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_arena_created
  ON public.notifications (arena_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_team_created
  ON public.notifications (team_id, created_at DESC);

-- 3. increment_warning — separate RPC for warnings (jury calls this directly)
CREATE OR REPLACE FUNCTION public.increment_warning(
  p_match_id UUID,
  p_team_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match RECORD;
  v_w1 INT;
  v_w2 INT;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_match.team1_id = p_team_id THEN
    UPDATE public.matches
    SET warnings_team1 = COALESCE(warnings_team1, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  ELSIF v_match.team2_id = p_team_id THEN
    UPDATE public.matches
    SET warnings_team2 = COALESCE(warnings_team2, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  ELSE
    RAISE EXCEPTION 'Team does not belong to this match';
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'match_id', p_match_id,
    'warnings_team1', v_w1,
    'warnings_team2', v_w2
  );
END;
$$;

-- 4. submit_match_round — SINGLE canonical definition.
-- Params: (p_match_id, p_request_id, p_round_number, p_team1_result, p_team2_result)
-- Result encoding: 1 = win, 0 = loss, NULL = null/draw.
-- Round 4 is restricted to decisive win/loss only (server-enforced).
-- current_round auto-advances here — clients must NOT compute it.
CREATE OR REPLACE FUNCTION public.submit_match_round(
  p_match_id UUID,
  p_request_id UUID,
  p_round_number INT,
  p_team1_result INT,
  p_team2_result INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_match RECORD;
  v_next_round INT;
  v_w1_count INT := 0;
  v_w2_count INT := 0;
  v_match_winner UUID := NULL;
BEGIN
  -- Idempotency: same request_id retried (double-click / retry) → same answer.
  -- NOTE: compared as text — an early draft created request_id as TEXT, so
  -- a direct uuid comparison raises "operator does not exist: text = uuid".
  SELECT * INTO v_existing
  FROM public.match_rounds WHERE request_id::text = p_request_id::text;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'round_id', v_existing.id,
      'round_number', v_existing.round_number
    );
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF v_match.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Match already completed';
  END IF;
  IF p_round_number < 1 OR p_round_number > 4 THEN
    RAISE EXCEPTION 'Round must be between 1 and 4';
  END IF;

  -- Rounds 1-3: win/loss or null/null. Round 4: decisive win/loss ONLY.
  -- NOTE: IS NOT DISTINCT FROM (not =) so NULLs compare correctly.
  IF p_round_number = 4 THEN
    IF NOT ((p_team1_result IS NOT DISTINCT FROM 1 AND p_team2_result IS NOT DISTINCT FROM 0)
         OR (p_team1_result IS NOT DISTINCT FROM 0 AND p_team2_result IS NOT DISTINCT FROM 1)) THEN
      RAISE EXCEPTION 'Round 4 requires a decisive win/loss (no nulls)';
    END IF;
  ELSE
    IF NOT ((p_team1_result IS NOT DISTINCT FROM 1 AND p_team2_result IS NOT DISTINCT FROM 0)
         OR (p_team1_result IS NOT DISTINCT FROM 0 AND p_team2_result IS NOT DISTINCT FROM 1)
         OR (p_team1_result IS NULL AND p_team2_result IS NULL)) THEN
      RAISE EXCEPTION 'Rounds 1-3 require win/loss or null/null';
    END IF;
  END IF;

  INSERT INTO public.match_rounds (
    match_id, round_number, team1_result, team2_result, request_id
  ) VALUES (
    p_match_id, p_round_number, p_team1_result, p_team2_result, p_request_id
  );

  -- Wins so far (best-of: first to 2)
  SELECT
    COUNT(*) FILTER (WHERE team1_result = 1),
    COUNT(*) FILTER (WHERE team2_result = 1)
  INTO v_w1_count, v_w2_count
  FROM public.match_rounds
  WHERE match_id = p_match_id;

  IF v_w1_count >= 2 THEN
    v_match_winner := v_match.team1_id;
  ELSIF v_w2_count >= 2 THEN
    v_match_winner := v_match.team2_id;
  ELSIF p_round_number = 4 THEN
    -- Round 4 only happens at 0-0-0 (all null), so it always decides
    IF p_team1_result = 1 THEN
      v_match_winner := v_match.team1_id;
    ELSIF p_team2_result = 1 THEN
      v_match_winner := v_match.team2_id;
    END IF;
  END IF;

  -- Server-side auto-advance. No client-side round logic.
  v_next_round := p_round_number + 1;

  UPDATE public.matches
  SET
    current_round = v_next_round,
    -- status is a match_status ENUM, so cast the CASE result explicitly.
    status = (CASE WHEN v_match_winner IS NOT NULL THEN 'COMPLETED' ELSE 'IN_PROGRESS' END)::public.match_status,
    winner_id = COALESCE(v_match_winner, winner_id)
  WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'match_id', p_match_id,
    'round_number', p_round_number,
    'current_round', v_next_round,
    'winner_id', v_match_winner
  );
END;
$$;

-- 5. Get Ready trigger: on round-2 insert, notify the NEXT match in the arena
CREATE OR REPLACE FUNCTION public.notify_next_match_on_round2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_arena TEXT;
  v_qindex INT;
  v_next_match RECORD;
BEGIN
  IF NEW.round_number = 2 THEN
    SELECT arena_id, queue_index INTO v_arena, v_qindex
    FROM public.matches WHERE id = NEW.match_id;

    SELECT * INTO v_next_match
    FROM public.matches
    WHERE arena_id = v_arena
      AND queue_index > v_qindex
      AND status IN ('PENDING', 'PUBLISHED')
    ORDER BY queue_index ASC
    LIMIT 1;

    IF FOUND THEN
      IF v_next_match.team1_id IS NOT NULL THEN
        INSERT INTO public.notifications (arena_id, team_id, match_id, message, type)
        VALUES (v_arena, v_next_match.team1_id, v_next_match.id,
                'GET READY: Your match is next in ' || v_arena, 'GET_READY');
      END IF;
      IF v_next_match.team2_id IS NOT NULL THEN
        INSERT INTO public.notifications (arena_id, team_id, match_id, message, type)
        VALUES (v_arena, v_next_match.team2_id, v_next_match.id,
                'GET READY: Your match is next in ' || v_arena, 'GET_READY');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_round2 ON public.match_rounds;
CREATE TRIGGER trg_notify_round2
AFTER INSERT ON public.match_rounds
FOR EACH ROW
EXECUTE FUNCTION public.notify_next_match_on_round2();
