-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: generate_phase1_matches + leaderboard
-- RUN SECOND in the Supabase SQL editor (after phase1_setup.sql).
-- Idempotent: safe to re-run. Re-running deletes prior qualification
-- matches and regenerates them deterministically from the CURRENT roster.
--
-- Roster-adaptive + D-day no-show rule:
--   The generator builds ONLY from the teams table as it stands. Delete
--   absent teams on the Teams page first, then (re)generate: every scheduled
--   match is present-vs-present, so nobody walks over a no-show. The total
--   is floor(3N/2) — fewer than 54 when teams are missing, by design.
--
-- Guarantee: every present team plays exactly 3 matches against 3 DISTINCT
-- opponents, except when N is odd — then exactly ONE team plays 2
-- (3N is odd, so 3-each is arithmetically impossible; one short is the
-- optimum). Zero repeated pairings, always.
--
-- Method: circle-method 1-factorization, exactly 3 rounds.
--   Even N: 3 perfect rounds → 3N/2 pairs, everyone at 3.
--   Odd N:  3 rounds with a rotating bye (3 teams at 2), then one patch
--     match between two bye teams (first still-unused pairing among them)
--     → (3N-1)/2 pairs, one team at 2. If all 3 mutual pairings happen to
--     be taken (vanishingly rare), the patch is skipped → 3 teams at 2.
-- Round r feeds subphase r+1 (the patch goes to the subphase its first
-- endpoint sat out, so that team still appears only once there). Pairs deal
-- round-robin across the 4 arenas with a rotating start per subphase;
-- queue_index is PER ARENA (1..n, contiguous).
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
  v_odd BOOLEAN;
  v_slots INT;               -- circle slots: N when even, N+1 (one bye) when odd
  v_circle INT;              -- rotating circle size = v_slots - 1
  v_r INT;                   -- circle-method round (0-based, exactly 3)
  v_k INT;
  v_a INT;                   -- 0-based slot indexes within the round
  v_b INT;
  v_p1 UUID[] := '{}';       -- team1 side of the chosen pairs (generation order)
  v_p2 UUID[] := '{}';       -- team2 side of the chosen pairs
  v_psub INT[] := '{}';      -- subphase per pair (round r → subphase r+1)
  v_byes INT[] := '{}';      -- 0-based team indexes that sat out (odd N: one per round)
  v_nb INT;
  v_b0 INT; v_b1 INT; v_b2 INT;
  v_cands INT[][];           -- patch candidate bye-index pairs
  v_ci INT;
  v_pa UUID; v_pb UUID;
  v_patch_sub INT;
  v_patched BOOLEAN := false;
  v_shorts UUID[] := '{}';   -- teams below 3 matches (odd N only)
  v_j INT;
  v_subphase INT;
  v_arena TEXT;
  v_ai INT;
  v_arenas TEXT[] := ARRAY['Arena A', 'Arena B', 'Arena C', 'Arena D'];
  v_q INT[] := ARRAY[1, 1, 1, 1];    -- per-arena queue counters
  v_deal INT[] := ARRAY[0, 0, 0];    -- per-subphase dealt counters (arena rotation)
  v_total INT;
  v_unique INT;
  v_min INT;
  v_max INT;
  v_result JSONB;
BEGIN
  -- Wipe prior qualification data (knockout bracket untouched)
  DELETE FROM public.match_rounds
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = false);
  DELETE FROM public.notifications
  WHERE match_id IN (SELECT id FROM public.matches WHERE is_knockout = false);
  DELETE FROM public.matches WHERE is_knockout = false;

  -- Present roster only: deleted (no-show) teams are simply not here, so no
  -- scheduled match can reference them — zero walkovers by construction.
  -- (teams table has id,name only; name order keeps output deterministic.)
  SELECT array_agg(id ORDER BY name) INTO v_team_ids FROM public.teams;
  v_team_count := COALESCE(array_length(v_team_ids, 1), 0);

  IF v_team_count < 4 THEN
    RAISE EXCEPTION 'Need at least 4 teams to generate matches (got %)', v_team_count;
  END IF;

  v_odd := (v_team_count % 2) = 1;

  -- Circle-method round-robin: round r pairs slot (v_slots-1) [fixed] vs
  -- slot r, plus slot (r+k) vs slot (r-k) for k = 1..slots/2-1.
  -- Every round covers each team exactly once (odd count → one rotating
  -- bye), and no unordered pairing ever repeats across rounds.
  v_slots := v_team_count + (v_team_count % 2);  -- N if even, N+1 if odd
  v_circle := v_slots - 1;

  FOR v_r IN 0..2 LOOP
    -- Fixed slot vs rotating slot
    v_a := v_slots - 1;
    v_b := v_r % v_circle;
    IF v_a >= v_team_count OR v_b >= v_team_count THEN
      -- Bye pair (odd N only): the real side sits this round out.
      IF v_a < v_team_count THEN
        v_byes := v_byes || v_a;
      ELSE
        v_byes := v_byes || v_b;
      END IF;
    ELSE
      v_p1 := v_p1 || v_team_ids[v_a + 1];
      v_p2 := v_p2 || v_team_ids[v_b + 1];
      v_psub := v_psub || (v_r + 1);
    END IF;
    -- Mirrored pairs around the circle
    FOR v_k IN 1..(v_slots / 2 - 1) LOOP
      v_a := (v_r + v_k) % v_circle;
      v_b := (((v_r - v_k) % v_circle) + v_circle) % v_circle;
      IF v_a >= v_team_count OR v_b >= v_team_count THEN
        IF v_a < v_team_count THEN
          v_byes := v_byes || v_a;
        ELSE
          v_byes := v_byes || v_b;
        END IF;
      ELSE
        v_p1 := v_p1 || v_team_ids[v_a + 1];
        v_p2 := v_p2 || v_team_ids[v_b + 1];
        v_psub := v_psub || (v_r + 1);
      END IF;
    END LOOP;
  END LOOP;

  -- Odd N: 3 bye teams sit at 2 matches. Patch two of them together
  -- (first still-unused pairing) → exactly one team stays at 2.
  IF v_odd THEN
    v_nb := COALESCE(array_length(v_byes, 1), 0);
    IF v_nb <> 3 THEN
      RAISE EXCEPTION 'Expected 3 bye slots for odd roster, got %', v_nb;
    END IF;
    v_b0 := v_byes[1]; v_b1 := v_byes[2]; v_b2 := v_byes[3];
    v_cands := ARRAY[[v_b0, v_b1], [v_b1, v_b2], [v_b0, v_b2]];
    FOR v_ci IN 1..3 LOOP
      v_pa := v_team_ids[v_cands[v_ci][1] + 1];
      v_pb := v_team_ids[v_cands[v_ci][2] + 1];
      IF NOT EXISTS (
        SELECT 1 FROM (
          SELECT v_p1[i] AS t1, v_p2[i] AS t2
          FROM generate_series(1, COALESCE(array_length(v_p1, 1), 0)) AS i
        ) p
        WHERE (p.t1 = v_pa AND p.t2 = v_pb)
           OR (p.t1 = v_pb AND p.t2 = v_pa)
      ) THEN
        -- Host it in the subphase the first endpoint sat out, so that team
        -- still appears only once there.
        v_patch_sub := 1;
        FOR v_r IN 0..2 LOOP
          IF v_byes[v_r + 1] = v_cands[v_ci][1] THEN
            v_patch_sub := v_r + 1;
          END IF;
        END LOOP;
        v_p1 := v_p1 || v_pa;
        v_p2 := v_p2 || v_pb;
        v_psub := v_psub || v_patch_sub;
        v_patched := true;
        -- The leftover bye team is the short one.
        FOR v_r IN 1..3 LOOP
          IF v_byes[v_r] <> v_cands[v_ci][1] AND v_byes[v_r] <> v_cands[v_ci][2] THEN
            v_shorts := v_shorts || v_team_ids[v_byes[v_r] + 1];
          END IF;
        END LOOP;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_patched THEN
      -- All 3 mutual pairings taken (vanishingly rare) — accept 3 at 2.
      FOR v_r IN 1..3 LOOP
        v_shorts := v_shorts || v_team_ids[v_byes[v_r] + 1];
      END LOOP;
    END IF;
  END IF;

  -- Deal subphase-major: round r already feeds subphase r+1; within each
  -- subphase, pairs go round-robin across the 4 arenas with a rotating
  -- start, keeping per-arena queues contiguous from 1.
  FOR v_j IN 1..COALESCE(array_length(v_p1, 1), 0) LOOP
    v_subphase := v_psub[v_j];
    v_ai := ((v_subphase - 1) + v_deal[v_subphase]) % 4 + 1;
    v_arena := v_arenas[v_ai];
    INSERT INTO public.matches (
      arena_id, queue_index, subphase,
      team1_id, team2_id, status,
      current_round, warnings_team1, warnings_team2, is_knockout
    ) VALUES (
      v_arena, v_q[v_ai], v_subphase,
      v_p1[v_j], v_p2[v_j], 'PENDING',
      1, 0, 0, false
    );
    v_q[v_ai] := v_q[v_ai] + 1;
    v_deal[v_subphase] := v_deal[v_subphase] + 1;
  END LOOP;

  -- Self-verification: fail loud, never schedule a broken round-robin.
  SELECT COUNT(*) INTO v_unique FROM (
    SELECT DISTINCT
      LEAST(team1_id::text, team2_id::text) || '-' ||
      GREATEST(team1_id::text, team2_id::text) AS pairing
    FROM public.matches WHERE is_knockout = false
  ) p;
  SELECT COUNT(*) INTO v_total FROM public.matches WHERE is_knockout = false;
  IF v_unique <> v_total THEN
    RAISE EXCEPTION 'Duplicate pairing generated (% unique of %)', v_unique, v_total;
  END IF;

  SELECT COALESCE(MIN(c), 0), COALESCE(MAX(c), 0) INTO v_min, v_max FROM (
    SELECT COUNT(m.id) AS c FROM public.teams t
    LEFT JOIN public.matches m
      ON (m.team1_id = t.id OR m.team2_id = t.id)
      AND m.is_knockout = false
    GROUP BY t.id
  ) s;
  IF v_odd THEN
    IF v_max <> 3 OR v_min < 2 THEN
      RAISE EXCEPTION 'Workload out of bounds for odd roster (min %, max %)', v_min, v_max;
    END IF;
  ELSIF v_min <> 3 OR v_max <> 3 THEN
    RAISE EXCEPTION 'Workload out of bounds for even roster (min %, max %)', v_min, v_max;
  END IF;

  v_result := jsonb_build_object(
    'teams', v_team_count,
    'total_matches', v_total,
    'expected_total', (3 * v_team_count) / 2,
    'unique_pairings', v_unique,
    'patched', v_patched,
    'short_teams', COALESCE(array_length(v_shorts, 1), 0),
    'short_team_ids', to_jsonb(v_shorts),
    'matches_per_team_min', v_min,
    'matches_per_team_max', v_max,
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
