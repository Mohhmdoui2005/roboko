-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: Phase 1 Qualification Engine Database Schema Extensions
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ensure current_round and warning columns exist on matches
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS current_round INT DEFAULT 1;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS warnings_team1 INT DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS warnings_team2 INT DEFAULT 0;

-- 2. Create notifications table
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
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Public and auth can read notifications'
  ) THEN
    CREATE POLICY "Public and auth can read notifications" ON public.notifications FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Service role full access notifications'
  ) THEN
    CREATE POLICY "Service role full access notifications" ON public.notifications USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Enable realtime on notifications if desired (or polling)
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 3. increment_warning RPC
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
    'match_id', p_match_id,
    'warnings_team1', v_w1,
    'warnings_team2', v_w2
  );
END;
$$;

-- 4. submit_match_round RPC (supporting parameter aliases)
CREATE OR REPLACE FUNCTION public.submit_match_round(
  p_match_id UUID,
  p_request_id UUID,
  p_round_number INT,
  p_team1_res INT,
  p_team2_res INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_match RECORD;
  v_r1_null BOOLEAN := false;
  v_r2_null BOOLEAN := false;
  v_r3_null BOOLEAN := false;
  v_next_round INT;
  v_w1_count INT := 0;
  v_w2_count INT := 0;
  v_match_winner UUID := NULL;
BEGIN
  -- Check idempotency
  SELECT * INTO v_existing FROM public.match_rounds WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_processed', 'round_id', v_existing.id);
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Insert round result
  INSERT INTO public.match_rounds (
    match_id,
    round_number,
    team1_result,
    team2_result,
    request_id
  ) VALUES (
    p_match_id,
    p_round_number,
    p_team1_res,
    p_team2_res,
    p_request_id
  );

  -- Count wins so far across all rounds for this match
  SELECT 
    COUNT(*) FILTER (WHERE team1_result = 1),
    COUNT(*) FILTER (WHERE team2_result = 1)
  INTO v_w1_count, v_w2_count
  FROM public.match_rounds
  WHERE match_id = p_match_id;

  -- Determine if match is completed (best of 3 wins or round 4 decided)
  IF v_w1_count >= 2 THEN
    v_match_winner := v_match.team1_id;
  ELSIF v_w2_count >= 2 THEN
    v_match_winner := v_match.team2_id;
  ELSIF p_round_number = 4 THEN
    IF p_team1_res = 1 THEN
      v_match_winner := v_match.team1_id;
    ELSIF p_team2_res = 1 THEN
      v_match_winner := v_match.team2_id;
    END IF;
  END IF;

  -- Calculate next round
  v_next_round := p_round_number + 1;

  UPDATE public.matches
  SET 
    current_round = v_next_round,
    status = CASE WHEN v_match_winner IS NOT NULL THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
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

-- Also support submit_match_round with p_team1_result / p_team2_result
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
BEGIN
  RETURN public.submit_match_round(
    p_match_id,
    p_request_id,
    p_round_number,
    p_team1_result,
    p_team2_result
  );
END;
$$;

-- 5. Trigger for "Get Ready" notifications on Round 2 completion
CREATE OR REPLACE FUNCTION public.notify_next_match_on_round2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match RECORD;
  v_next_match RECORD;
  v_arena TEXT;
BEGIN
  IF NEW.round_number = 2 THEN
    SELECT arena_id, queue_index INTO v_match FROM public.matches WHERE id = NEW.match_id;
    v_arena := v_match.arena_id;

    -- Find the next match in the queue for this arena
    SELECT * INTO v_next_match
    FROM public.matches
    WHERE arena_id = v_arena
      AND queue_index > v_match.queue_index
      AND status IN ('PENDING', 'PUBLISHED')
    ORDER BY queue_index ASC
    LIMIT 1;

    IF FOUND THEN
      -- Create notification for arena and both teams
      IF v_next_match.team1_id IS NOT NULL THEN
        INSERT INTO public.notifications (arena_id, team_id, match_id, message, type)
        VALUES (
          v_arena,
          v_next_match.team1_id,
          v_next_match.id,
          'GET READY: Your match is next in ' || v_arena,
          'GET_READY'
        );
      END IF;

      IF v_next_match.team2_id IS NOT NULL THEN
        INSERT INTO public.notifications (arena_id, team_id, match_id, message, type)
        VALUES (
          v_arena,
          v_next_match.team2_id,
          v_next_match.id,
          'GET READY: Your match is next in ' || v_arena,
          'GET_READY'
        );
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

-- 6. get_phase1_leaderboard function
CREATE OR REPLACE FUNCTION public.get_phase1_leaderboard()
RETURNS TABLE (
  team_id UUID,
  name TEXT,
  matches_played BIGINT,
  wins BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    team_id,
    name,
    matches_played,
    wins
  FROM public.phase1_leaderboard
  ORDER BY wins DESC, matches_played ASC, name ASC;
$$;
