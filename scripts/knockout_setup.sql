-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: Knockout Engine & Bracket
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Bracket model (existing bracket_nodes table):
--   {id, ko_stage INT, position INT, match_id, next_node_id, created_at}
--   ko_stage 16 → R16 (8 nodes/matches), 8 → QF (4), 4 → SF (2),
--   2 → Final (1), 1 → Champion marker (1 node, NO match).
--   Total: 16 nodes, 15 matches. next_node_id points child → parent.
--   Teams live on matches; lower child position feeds parent team1,
--   higher feeds team2. Knockout matches carry phase='KNOCKOUT'.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop stale stubs first: Postgres cannot change a function's return type
-- via CREATE OR REPLACE (error 42P13).
DROP FUNCTION IF EXISTS public.publish_knockout_bracket(UUID[]);
DROP FUNCTION IF EXISTS public.publish_knockout_bracket();
DROP FUNCTION IF EXISTS public.get_knockout_seeds();
-- Trigger from a partial earlier run depends on the function: drop it first.
DROP TRIGGER IF EXISTS trg_advance_knockout ON public.matches;
DROP FUNCTION IF EXISTS public.advance_knockout_winner();

-- 1. Phase column (QUALIFICATION vs KNOCKOUT) + node touch column
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'QUALIFICATION';
ALTER TABLE public.bracket_nodes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill: everything knockout-flagged is KNOCKOUT phase
UPDATE public.matches SET phase = 'KNOCKOUT'
WHERE is_knockout = true AND (phase IS NULL OR phase <> 'KNOCKOUT');

-- 2. RLS + realtime for bracket_nodes
ALTER TABLE public.bracket_nodes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bracket_nodes' AND policyname = 'Anyone can read bracket nodes'
  ) THEN
    CREATE POLICY "Anyone can read bracket nodes"
      ON public.bracket_nodes FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bracket_nodes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_nodes;
  END IF;
END $$;

-- 3. Seeds: top 16 of the Phase 1 leaderboard
CREATE OR REPLACE FUNCTION public.get_knockout_seeds()
RETURNS TABLE (
  seed INT,
  team_id UUID,
  name TEXT,
  wins BIGINT,
  matches_played BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY wins DESC, matches_played ASC, name ASC)::int AS seed,
    team_id, name, wins, matches_played
  FROM public.phase1_leaderboard
  ORDER BY wins DESC, matches_played ASC, name ASC
  LIMIT 16;
$$;

-- 4. publish_knockout_bracket — wipes prior KO bracket, creates 16 nodes +
-- 15 matches with round-robin arena allocation, sets knockout_live = true.
CREATE OR REPLACE FUNCTION public.publish_knockout_bracket(p_seeds UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_arenas TEXT[] := ARRAY['Arena A', 'Arena B', 'Arena C', 'Arena D'];
  v_q INT[] := ARRAY[19, 19, 19, 19];  -- per-arena KO queues continue after qual (1..13/14)
  v_k INT := 0;
  v_ai INT;
  v_arena TEXT;
  v_queue INT;
  v_mid UUID;
  v_r16 UUID[] := '{}';
  v_qf UUID[] := '{}';
  v_sf UUID[] := '{}';
  v_f UUID;
  v_r16n UUID[] := '{}';
  v_qfn UUID[] := '{}';
  v_sfn UUID[] := '{}';
  v_fn UUID;
  v_champ UUID;
  v_i INT;
BEGIN
  -- Validate: exactly 16 distinct existing teams
  IF p_seeds IS NULL OR COALESCE(array_length(p_seeds, 1), 0) <> 16 THEN
    RAISE EXCEPTION 'Need exactly 16 seeds, got %', COALESCE(array_length(p_seeds, 1), 0);
  END IF;
  IF (SELECT COUNT(*) FROM (SELECT DISTINCT unnest(p_seeds)) s) <> 16 THEN
    RAISE EXCEPTION 'Seeds must be 16 distinct teams';
  END IF;
  IF (SELECT COUNT(*) FROM public.teams t WHERE t.id = ANY (p_seeds)) <> 16 THEN
    RAISE EXCEPTION 'One or more seed team IDs do not exist';
  END IF;

  -- Wipe prior knockout bracket (qualification untouched)
  DELETE FROM public.match_rounds
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = true);
  DELETE FROM public.matches WHERE is_knockout = true;
  -- WHERE clause required: hosted Postgres rejects WHERE-less DELETEs.
  DELETE FROM public.bracket_nodes WHERE id IS NOT NULL;

  -- R16: consecutive seed pairs (array order = final order after shuffle)
  FOR v_i IN 1..8 LOOP
    v_ai := (v_k % 4) + 1; v_arena := v_arenas[v_ai]; v_queue := v_q[v_ai];
    v_q[v_ai] := v_q[v_ai] + 1; v_k := v_k + 1;
    INSERT INTO public.matches (
      arena_id, queue_index, team1_id, team2_id, status,
      current_round, warnings_team1, warnings_team2,
      is_knockout, phase, winner_id
    ) VALUES (
      v_arena, v_queue, p_seeds[v_i * 2 - 1], p_seeds[v_i * 2],
      'PUBLISHED', 1, 0, 0, true, 'KNOCKOUT', NULL
    ) RETURNING id INTO v_mid;
    v_r16 := v_r16 || v_mid;
    INSERT INTO public.bracket_nodes (ko_stage, position, match_id, next_node_id)
    VALUES (16, v_i - 1, v_mid, NULL) RETURNING id INTO v_mid;
    v_r16n := v_r16n || v_mid;
  END LOOP;

  -- QF / SF / Final: matches created empty (teams filled by advancement)
  FOR v_i IN 1..4 LOOP
    v_ai := (v_k % 4) + 1; v_arena := v_arenas[v_ai]; v_queue := v_q[v_ai];
    v_q[v_ai] := v_q[v_ai] + 1; v_k := v_k + 1;
    INSERT INTO public.matches (
      arena_id, queue_index, team1_id, team2_id, status,
      current_round, warnings_team1, warnings_team2,
      is_knockout, phase, winner_id
    ) VALUES (
      v_arena, v_queue, NULL, NULL,
      'PUBLISHED', 1, 0, 0, true, 'KNOCKOUT', NULL
    ) RETURNING id INTO v_mid;
    v_qf := v_qf || v_mid;
    INSERT INTO public.bracket_nodes (ko_stage, position, match_id, next_node_id)
    VALUES (8, v_i - 1, v_mid, NULL) RETURNING id INTO v_mid;
    v_qfn := v_qfn || v_mid;
  END LOOP;

  FOR v_i IN 1..2 LOOP
    v_ai := (v_k % 4) + 1; v_arena := v_arenas[v_ai]; v_queue := v_q[v_ai];
    v_q[v_ai] := v_q[v_ai] + 1; v_k := v_k + 1;
    INSERT INTO public.matches (
      arena_id, queue_index, team1_id, team2_id, status,
      current_round, warnings_team1, warnings_team2,
      is_knockout, phase, winner_id
    ) VALUES (
      v_arena, v_queue, NULL, NULL,
      'PUBLISHED', 1, 0, 0, true, 'KNOCKOUT', NULL
    ) RETURNING id INTO v_mid;
    v_sf := v_sf || v_mid;
    INSERT INTO public.bracket_nodes (ko_stage, position, match_id, next_node_id)
    VALUES (4, v_i - 1, v_mid, NULL) RETURNING id INTO v_mid;
    v_sfn := v_sfn || v_mid;
  END LOOP;

  v_ai := (v_k % 4) + 1; v_arena := v_arenas[v_ai]; v_queue := v_q[v_ai];
  INSERT INTO public.matches (
    arena_id, queue_index, team1_id, team2_id, status,
    current_round, warnings_team1, warnings_team2,
    is_knockout, phase, winner_id
  ) VALUES (
    v_arena, v_queue, NULL, NULL,
    'PUBLISHED', 1, 0, 0, true, 'KNOCKOUT', NULL
  ) RETURNING id INTO v_f;
  INSERT INTO public.bracket_nodes (ko_stage, position, match_id, next_node_id)
  VALUES (2, 0, v_f, NULL) RETURNING id INTO v_fn;

  -- Champion marker (no match; display derives from the Final winner)
  INSERT INTO public.bracket_nodes (ko_stage, position, match_id, next_node_id)
  VALUES (1, 0, NULL, NULL) RETURNING id INTO v_champ;

  -- Link child → parent
  FOR v_i IN 1..8 LOOP
    UPDATE public.bracket_nodes SET next_node_id = v_qfn[(v_i - 1) / 2 + 1]
    WHERE id = v_r16n[v_i];
  END LOOP;
  FOR v_i IN 1..4 LOOP
    UPDATE public.bracket_nodes SET next_node_id = v_sfn[(v_i - 1) / 2 + 1]
    WHERE id = v_qfn[v_i];
  END LOOP;
  FOR v_i IN 1..2 LOOP
    UPDATE public.bracket_nodes SET next_node_id = v_fn
    WHERE id = v_sfn[v_i];
  END LOOP;
  UPDATE public.bracket_nodes SET next_node_id = v_champ WHERE id = v_fn;

  UPDATE public.tournament_state
  SET knockout_live = true, updated_at = now()
  WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'status', 'success',
    'nodes', 16,
    'matches', 15,
    'knockout_live', true);
END;
$$;

-- 5. Server-side auto-advancement: on knockout completion, copy the winner
-- into the parent match slot (lower child position → team1, higher → team2)
-- and touch the parent (+champion) node so bracket realtime subscribers
-- refresh. No client logic involved.
CREATE OR REPLACE FUNCTION public.advance_knockout_winner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_node RECORD;
  v_parent RECORD;
  v_child RECORD;
  v_winners UUID[] := '{}';
  v_pm RECORD;
BEGIN
  IF NOT COALESCE(NEW.is_knockout, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text IS DISTINCT FROM 'COMPLETED' THEN
    RETURN NEW;
  END IF;
  IF NEW.winner_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.winner_id IS NOT DISTINCT FROM NEW.winner_id THEN
    RETURN NEW;  -- fire once per completion, no loops
  END IF;

  SELECT * INTO v_node FROM public.bracket_nodes WHERE match_id = NEW.id;
  IF NOT FOUND OR v_node.next_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent FROM public.bracket_nodes WHERE id = v_node.next_node_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Champion marker: nothing to fill — just touch it for realtime.
  IF v_parent.match_id IS NULL THEN
    UPDATE public.bracket_nodes SET updated_at = now() WHERE id = v_parent.id;
    RETURN NEW;
  END IF;

  -- Winners of all completed children, ordered by child position
  FOR v_child IN
    SELECT m.winner_id AS w
    FROM public.bracket_nodes bn
    LEFT JOIN public.matches m ON m.id = bn.match_id
    WHERE bn.next_node_id = v_parent.id
    ORDER BY bn.position ASC
  LOOP
    v_winners := v_winners || v_child.w;
  END LOOP;

  SELECT * INTO v_pm FROM public.matches WHERE id = v_parent.match_id;

  UPDATE public.matches
  SET
    team1_id = COALESCE(v_winners[1], team1_id),
    team2_id = COALESCE(v_winners[2], team2_id)
  WHERE id = v_parent.match_id;

  UPDATE public.bracket_nodes SET updated_at = now() WHERE id = v_parent.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advance_knockout ON public.matches;
CREATE TRIGGER trg_advance_knockout
AFTER UPDATE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.advance_knockout_winner();

-- 6. unpublish_knockout_bracket — takes a published bracket back down:
-- wipes KO matches/rounds/nodes and sets knockout_live = false.
-- Refuses when any KO match has already started (IN_PROGRESS/COMPLETED)
-- so live results can never be deleted by accident.
CREATE OR REPLACE FUNCTION public.unpublish_knockout_bracket()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_started INT;
  v_removed INT;
BEGIN
  SELECT COUNT(*) INTO v_started FROM public.matches
  WHERE is_knockout = true AND status IN ('IN_PROGRESS', 'COMPLETED');
  IF v_started > 0 THEN
    RAISE EXCEPTION 'Cannot unpublish: % knockout match(es) already started or completed', v_started;
  END IF;

  DELETE FROM public.match_rounds
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = true);
  DELETE FROM public.matches WHERE is_knockout = true;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  -- WHERE clause required: hosted Postgres rejects WHERE-less DELETEs.
  DELETE FROM public.bracket_nodes WHERE id IS NOT NULL;

  UPDATE public.tournament_state
  SET knockout_live = false, updated_at = now()
  WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'status', 'success',
    'removed_matches', v_removed,
    'knockout_live', false);
END;
$$;
