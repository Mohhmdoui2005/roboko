-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: generate_phase1_matches + leaderboard
-- RUN SECOND in the Supabase SQL editor (after phase1_setup.sql).
-- Idempotent: safe to re-run. Re-running deletes prior qualification
-- matches and regenerates them deterministically.
--
-- Design (matches the acceptance criteria):
--   36 teams → circle-method round-robin: each "round" pairs every team
--   exactly once (18 pairs, all 36 teams, zero repeats). The first
--   3 rounds give exactly 54 unique pairings with every team playing
--   EXACTLY 3 matches against 3 DIFFERENT opponents (3-regular schedule:
--   36×3/2 = 54). Round r feeds subphase r+1, so each team also plays
--   exactly once per subphase.
--   4 arenas × 3 subphases = 54 (14/14/13/13 across arenas).
--   Each subphase deals its 18 pairs round-robin across the arenas with a
--   rotating start (S1: A,B,C,D → 5/5/4/4; S2: B,C,D,A → 5/5/4/4;
--   S3: C,D,A,B → 5/5/4/4; totals A13/B14/C14/D13).
--   queue_index is PER ARENA (1..N, contiguous per subphase block).
--   Zero repeated pairings globally, per subphase, and per arena.
-- ═══════════════════════════════════════════════════════════════════════════

-- Stale void stubs from earlier setup cannot change return type via
-- CREATE OR REPLACE → drop them (and dependents) first.
DROP FUNCTION IF EXISTS public.get_phase1_leaderboard();
-- phase1_leaderboard may exist as a plain VIEW, a MATERIALIZED VIEW, or
-- even a TABLE (early drafts created different variants); DROP and
-- CREATE OR REPLACE VIEW are all type-specific (error 42809), so dispatch
-- on the actual object kind.
DO $$
DECLARE
  v_kind CHAR;
BEGIN
  SELECT c.relkind INTO v_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'phase1_leaderboard';

  IF v_kind = 'm' THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.phase1_leaderboard';
  ELSIF v_kind = 'v' THEN
    EXECUTE 'DROP VIEW public.phase1_leaderboard';
  ELSIF v_kind = 'r' THEN
    EXECUTE 'DROP TABLE public.phase1_leaderboard';
  ELSIF v_kind = 'f' THEN
    EXECUTE 'DROP FOREIGN TABLE public.phase1_leaderboard';
  ELSIF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'phase1_leaderboard exists as unexpected object kind "%" — drop it manually', v_kind;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.generate_phase1_matches();
DROP FUNCTION IF EXISTS public.refresh_leaderboard();

CREATE OR REPLACE FUNCTION public.generate_phase1_matches()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_ids UUID[];
  v_team_count INT;
  v_p1 UUID[] := '{}';   -- team1 side of the 54 chosen pairs
  v_p2 UUID[] := '{}';   -- team2 side of the 54 chosen pairs
  v_r INT;               -- circle-method round (0-based)
  v_k INT;
  v_slots INT;           -- circle slots: n when even, n+1 (one bye) when odd
  v_circle INT;          -- rotating circle size = v_slots - 1
  v_ppr INT;             -- real pairs per full round = floor(n/2)
  v_full_rounds INT;
  v_rem INT;
  v_rounds_needed INT;
  v_a INT;               -- 0-based slot indexes within the round
  v_b INT;
  v_idx INT := 1;
  v_subphase INT;
  v_j INT;
  v_arena TEXT;
  v_ai INT;
  v_arenas TEXT[] := ARRAY['Arena A', 'Arena B', 'Arena C', 'Arena D'];
  v_q INT[] := ARRAY[1, 1, 1, 1];  -- per-arena queue counters
  v_unique INT;
  v_result JSONB;
BEGIN
  -- Wipe prior qualification data (knockout bracket untouched)
  DELETE FROM public.match_rounds
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = false);
  DELETE FROM public.notifications
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = false);
  DELETE FROM public.matches WHERE is_knockout = false;

  -- All teams, deterministic order. (teams table has id,name only.)
  SELECT array_agg(id ORDER BY name) INTO v_team_ids FROM public.teams;
  v_team_count := COALESCE(array_length(v_team_ids, 1), 0);

  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'Need at least 2 teams to generate matches';
  END IF;
  IF v_team_count * (v_team_count - 1) / 2 < 54 THEN
    RAISE EXCEPTION 'Only % teams: not enough unique pairings for 54 matches',
      v_team_count;
  END IF;

  -- Circle-method round-robin: round r pairs slot (v_slots-1) [fixed] vs
  -- slot r, plus slot (r+k) vs slot (r-k) for k = 1..slots/2-1.
  -- Every round covers each team exactly once (odd count → one rotating
  -- bye), and no unordered pairing ever repeats across rounds.
  -- 36 teams → 3 full rounds = 54 pairs, each team exactly 3×3 distinct.
  v_slots := v_team_count + (v_team_count % 2);  -- n if even, n+1 if odd
  v_circle := v_slots - 1;
  v_ppr := v_team_count / 2;                     -- integer division
  v_full_rounds := 54 / v_ppr;
  v_rem := 54 % v_ppr;
  v_rounds_needed := v_full_rounds + CASE WHEN v_rem > 0 THEN 1 ELSE 0 END;
  IF v_rounds_needed > v_circle THEN
    RAISE EXCEPTION 'Need % schedule rounds but only % available for % teams',
      v_rounds_needed, v_circle, v_team_count;
  END IF;

  FOR v_r IN 0..v_rounds_needed - 1 LOOP
    -- Fixed slot vs rotating slot
    v_a := v_slots - 1;
    v_b := v_r % v_circle;
    IF v_a < v_team_count AND v_b < v_team_count THEN
      v_p1 := v_p1 || v_team_ids[v_a + 1];
      v_p2 := v_p2 || v_team_ids[v_b + 1];
    END IF;
    EXIT WHEN COALESCE(array_length(v_p1, 1), 0) >= 54;
    -- Mirrored pairs around the circle
    FOR v_k IN 1..(v_slots / 2 - 1) LOOP
      EXIT WHEN COALESCE(array_length(v_p1, 1), 0) >= 54;
      v_a := (v_r + v_k) % v_circle;
      v_b := (((v_r - v_k) % v_circle) + v_circle) % v_circle;
      IF v_a < v_team_count AND v_b < v_team_count THEN
        v_p1 := v_p1 || v_team_ids[v_a + 1];
        v_p2 := v_p2 || v_team_ids[v_b + 1];
      END IF;
    END LOOP;
    EXIT WHEN COALESCE(array_length(v_p1, 1), 0) >= 54;
  END LOOP;

  IF COALESCE(array_length(v_p1, 1), 0) < 54 THEN
    RAISE EXCEPTION 'Schedule produced only % pairs (need 54)',
      COALESCE(array_length(v_p1, 1), 0);
  END IF;

  -- Deal subphase-major: each subphase's 18 pairs go round-robin across
  -- the 4 arenas, rotating the start arena per subphase for fair shares.
  FOR v_subphase IN 1..3 LOOP
    FOR v_j IN 0..17 LOOP
      v_ai := ((v_subphase - 1) + v_j) % 4 + 1;
      v_arena := v_arenas[v_ai];
      INSERT INTO public.matches (
        arena_id, queue_index, subphase,
        team1_id, team2_id, status,
        current_round, warnings_team1, warnings_team2, is_knockout
      ) VALUES (
        v_arena, v_q[v_ai], v_subphase,
        v_p1[v_idx], v_p2[v_idx], 'PENDING',
        1, 0, 0, false
      );
      v_q[v_ai] := v_q[v_ai] + 1;
      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;

  SELECT COUNT(*) INTO v_unique FROM (
    SELECT DISTINCT
      LEAST(team1_id::text, team2_id::text) || '-' ||
      GREATEST(team1_id::text, team2_id::text) AS pairing
    FROM public.matches WHERE is_knockout = false
  ) p;

  v_result := jsonb_build_object(
    'total_matches',
      (SELECT COUNT(*) FROM public.matches WHERE is_knockout = false),
    'unique_pairings', v_unique,
    'matches_per_team_min', (
      SELECT COALESCE(MIN(c), 0) FROM (
        SELECT COUNT(m.id) AS c FROM public.teams t
        LEFT JOIN public.matches m
          ON (m.team1_id = t.id OR m.team2_id = t.id)
          AND m.is_knockout = false
        GROUP BY t.id
      ) s
    ),
    'matches_per_team_max', (
      SELECT COALESCE(MAX(c), 0) FROM (
        SELECT COUNT(m.id) AS c FROM public.teams t
        LEFT JOIN public.matches m
          ON (m.team1_id = t.id OR m.team2_id = t.id)
          AND m.is_knockout = false
        GROUP BY t.id
      ) s
    ),
    'matches_per_arena', (
      SELECT COALESCE(jsonb_object_agg(arena_id, cnt), '{}'::jsonb) FROM (
        SELECT arena_id, COUNT(*) AS cnt FROM public.matches
        WHERE is_knockout = false GROUP BY arena_id
      ) t
    ),
    'matches_per_subphase', (
      SELECT COALESCE(jsonb_object_agg('subphase_' || subphase, cnt), '{}'::jsonb) FROM (
        SELECT subphase, COUNT(*) AS cnt FROM public.matches
        WHERE is_knockout = false GROUP BY subphase
      ) t
    )
  );

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Leaderboard: plain VIEW (always fresh) + RPC wrappers.
-- refresh_leaderboard exists so the admin UI has a manual-refresh RPC to
-- call per spec; it reports current counts (nothing stale to rebuild).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.phase1_leaderboard AS
SELECT
  t.id AS team_id,
  t.name AS name,
  COUNT(DISTINCT m.id) AS matches_played,
  COUNT(DISTINCT m.id) FILTER (WHERE m.winner_id = t.id) AS wins
FROM public.teams t
LEFT JOIN public.matches m
  ON (m.team1_id = t.id OR m.team2_id = t.id)
  AND m.is_knockout = false
  AND m.status = 'COMPLETED'
GROUP BY t.id, t.name
ORDER BY wins DESC, matches_played ASC, t.name ASC;

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
  SELECT team_id, name, matches_played, wins
  FROM public.phase1_leaderboard
  ORDER BY wins DESC, matches_played ASC, name ASC;
$$;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status', 'success',
    'refreshed_at', now(),
    'teams', (SELECT COUNT(*) FROM public.teams),
    'completed_matches',
      (SELECT COUNT(*) FROM public.matches
       WHERE is_knockout = false AND status = 'COMPLETED')
  );
END;
$$;
