-- ═══════════════════════════════════════════════════════════════════════════
-- PART 11: Warnings — decrement + 3-warning round forfeit
-- Run in the Supabase SQL editor AFTER phase1_setup.sql (submit_match_round)
-- and offline_setup.sql (processed_requests ledger). Idempotent: safe to re-run.
--
-- What changes:
--   increment_warning(..., p_request_id) → when a team's count reaches exactly 3
--     AND the match is not COMPLETED, the offender immediately loses the
--     current round (auto-submit 0 vs 1 via submit_match_round, fresh UUID).
--     Result carries `forfeit: {applied, round_number, ...}` (NULL when none).
--   decrement_warning(..., p_request_id) → NEW, mirrors increment idempotency,
--     floors at 0. A recorded forfeit stands (rescinding a warning does not
--     replay the round).
--   PART 12: warnings are PER-ROUND — every recorded round (played or
--     forfeited) resets both counters to 0, so the next round starts 0-0
--     with a fresh 3-warning allowance.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.processed_requests (
  request_id UUID PRIMARY KEY,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── increment_warning with 3-warning forfeit ────────────────────────────────
-- Signature change (new behaviour, same args) → drop stale versions first.
DROP FUNCTION IF EXISTS public.increment_warning(UUID, UUID);
DROP FUNCTION IF EXISTS public.increment_warning(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.increment_warning(
  p_match_id UUID,
  p_team_id UUID,
  p_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match RECORD;
  v_w1 INT;
  v_w2 INT;
  v_new_count INT;
  v_round INT;
  v_t1 INT;
  v_t2 INT;
  v_submit JSONB;
  v_forfeit JSONB := NULL;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF p_team_id IS DISTINCT FROM v_match.team1_id
     AND p_team_id IS DISTINCT FROM v_match.team2_id THEN
    RAISE EXCEPTION 'Team does not belong to this match';
  END IF;

  -- Replay guard: already counted → return current state, do NOT increment
  -- (and never re-forfeit: the forfeit below only fires on a fresh 3).
  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.processed_requests WHERE request_id = p_request_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'deduped', true,
      'match_id', p_match_id,
      'warnings_team1', v_match.warnings_team1,
      'warnings_team2', v_match.warnings_team2,
      'forfeit', NULL
    );
  END IF;

  IF v_match.team1_id = p_team_id THEN
    UPDATE public.matches
    SET warnings_team1 = COALESCE(warnings_team1, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
    v_new_count := v_w1;
  ELSE
    UPDATE public.matches
    SET warnings_team2 = COALESCE(warnings_team2, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
    v_new_count := v_w2;
  END IF;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.processed_requests (request_id, endpoint)
    VALUES (p_request_id, 'increment_warning')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3-warning forfeit: offender loses the current round immediately.
  -- Fires only on the fresh 2→3 transition of a live match. The nested block
  -- keeps the warning even if the auto-submit cannot run (race/completed).
  IF v_new_count = 3 AND v_match.status <> 'COMPLETED' THEN
    v_round := COALESCE(v_match.current_round, 1);
    IF v_round BETWEEN 1 AND 4 AND NOT EXISTS (
      SELECT 1 FROM public.match_rounds
      WHERE match_id = p_match_id AND round_number = v_round
    ) THEN
      IF v_match.team1_id = p_team_id THEN
        v_t1 := 0; v_t2 := 1;
      ELSE
        v_t1 := 1; v_t2 := 0;
      END IF;
      BEGIN
        SELECT public.submit_match_round(
          p_match_id, gen_random_uuid(), v_round, v_t1, v_t2
        ) INTO v_submit;
        v_forfeit := jsonb_build_object(
          'applied', true,
          'round_number', v_round,
          'team1_result', v_t1,
          'team2_result', v_t2,
          'submit', v_submit
        );
      EXCEPTION WHEN OTHERS THEN
        v_forfeit := jsonb_build_object(
          'applied', false,
          'round_number', v_round,
          'reason', SQLERRM
        );
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'deduped', false,
    'match_id', p_match_id,
    'warnings_team1', v_w1,
    'warnings_team2', v_w2,
    'forfeit', v_forfeit
  );
END;
$$;

-- ── decrement_warning (NEW, idempotent) ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.decrement_warning(UUID, UUID);
DROP FUNCTION IF EXISTS public.decrement_warning(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.decrement_warning(
  p_match_id UUID,
  p_team_id UUID,
  p_request_id UUID DEFAULT NULL
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
  IF p_team_id IS DISTINCT FROM v_match.team1_id
     AND p_team_id IS DISTINCT FROM v_match.team2_id THEN
    RAISE EXCEPTION 'Team does not belong to this match';
  END IF;

  -- Replay guard: already decremented → return current state.
  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.processed_requests WHERE request_id = p_request_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'deduped', true,
      'match_id', p_match_id,
      'warnings_team1', v_match.warnings_team1,
      'warnings_team2', v_match.warnings_team2
    );
  END IF;

  IF v_match.team1_id = p_team_id THEN
    UPDATE public.matches
    SET warnings_team1 = GREATEST(COALESCE(warnings_team1, 0) - 1, 0)
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  ELSE
    UPDATE public.matches
    SET warnings_team2 = GREATEST(COALESCE(warnings_team2, 0) - 1, 0)
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  END IF;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.processed_requests (request_id, endpoint)
    VALUES (p_request_id, 'decrement_warning')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'deduped', false,
    'match_id', p_match_id,
    'warnings_team1', v_w1,
    'warnings_team2', v_w2
  );
END;
$$;

-- ── PART 12: warnings are per-round ─────────────────────────────────────────
-- Every recorded round (played OR forfeited) resets both counters, so each
-- new round starts 0-0 with a fresh 3-warning allowance. Runs AFTER INSERT so
-- the forfeit above still fires on the fresh 2→3 transition, then the reset
-- lands in the same transaction (increment still reports the 3 that caused it).
CREATE OR REPLACE FUNCTION public.reset_warnings_on_new_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.matches
  SET warnings_team1 = 0,
      warnings_team2 = 0
  WHERE id = NEW.match_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_warnings_on_round ON public.match_rounds;
CREATE TRIGGER trg_reset_warnings_on_round
AFTER INSERT ON public.match_rounds
FOR EACH ROW
EXECUTE FUNCTION public.reset_warnings_on_new_round();
