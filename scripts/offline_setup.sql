-- ═══════════════════════════════════════════════════════════════════════════
-- PART 10: Offline Queue — request_id enforcement on every critical RPC
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Already idempotent (no change needed):
--   submit_match_round(p_request_id) → already_processed on retry
-- Added here:
--   processed_requests ledger (request_id PK)
--   increment_warning(..., p_request_id) → repeat returns current counts,
--     NEVER double-increments
--   claim_person_lunch(..., p_request_id) → recorded; uniqueness still by
--     user_id (replay returns duplicate with original timestamp)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.processed_requests (
  request_id UUID PRIMARY KEY,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- No RLS: only SECURITY DEFINER functions touch this table; clients have
-- no direct access (fail-closed if RLS is later enabled without policies).

-- ── increment_warning with idempotency ──────────────────────────────────────
-- NOTE: signature change (new optional param) → drop stale versions first.
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
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF p_team_id IS DISTINCT FROM v_match.team1_id
     AND p_team_id IS DISTINCT FROM v_match.team2_id THEN
    RAISE EXCEPTION 'Team does not belong to this match';
  END IF;

  -- Replay guard: already counted → return current state, do NOT increment.
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
    SET warnings_team1 = COALESCE(warnings_team1, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  ELSE
    UPDATE public.matches
    SET warnings_team2 = COALESCE(warnings_team2, 0) + 1
    WHERE id = p_match_id
    RETURNING warnings_team1, warnings_team2 INTO v_w1, v_w2;
  END IF;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.processed_requests (request_id, endpoint)
    VALUES (p_request_id, 'increment_warning')
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

-- ── claim_person_lunch with request_id ledger ───────────────────────────────
-- Signature change → drop stale versions first.
DROP FUNCTION IF EXISTS public.claim_person_lunch(TEXT);
DROP FUNCTION IF EXISTS public.claim_person_lunch(TEXT, UUID);
DROP FUNCTION IF EXISTS public.claim_person_lunch(TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.claim_person_lunch(
  p_payload TEXT,
  p_orga_id UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_data JSONB;
  v_user_id UUID;
  v_profile RECORD;
  v_orga UUID;
  v_existing RECORD;
  v_claimed_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF p_payload IS NULL OR btrim(p_payload) = '' THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'INVALID_QR',
      'message', 'Empty scan. Please scan the lunch badge QR again.');
  END IF;

  BEGIN
    v_data := p_payload::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'INVALID_QR',
      'message', 'This QR code is not a valid lunch badge (unreadable payload).');
  END;

  IF v_data->>'domain' IS DISTINCT FROM 'PERSON_LUNCH' THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'WRONG_DOMAIN',
      'message', 'This is not a lunch badge (expected a PERSON_LUNCH QR).');
  END IF;

  BEGIN
    v_user_id := (v_data->>'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'INVALID_QR',
      'message', 'Lunch badge has no valid user reference.');
  END;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id AND lunch_qr_payload = p_payload;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'UNKNOWN_OR_FORGED',
      'message', 'No lunch badge matches this QR. It may be forged, tampered, or not yet issued.',
      'user_id', v_user_id);
  END IF;

  SELECT * INTO v_existing
  FROM public.lunch_claims WHERE user_id = v_user_id;

  IF FOUND THEN
    v_result := jsonb_build_object(
      'status', 'duplicate', 'code', 'ALREADY_CLAIMED',
      'message', 'Lunch already claimed for ' || COALESCE(v_profile.name, 'this participant') || '.',
      'user_id', v_user_id,
      'user_name', v_profile.name,
      'claimed_at', v_existing.claimed_at);
  ELSE
    v_orga := COALESCE(p_orga_id, auth.uid());
    IF v_orga IS NULL THEN
      RETURN jsonb_build_object(
        'status', 'error', 'code', 'NOT_AUTHENTICATED',
        'message', 'Scanner is not signed in as orga staff.');
    END IF;

    BEGIN
      INSERT INTO public.lunch_claims (user_id, orga_id, claimed_at)
      VALUES (v_user_id, v_orga, now())
      RETURNING claimed_at INTO v_claimed_at;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_existing
      FROM public.lunch_claims WHERE user_id = v_user_id;
      v_claimed_at := v_existing.claimed_at;
    END;

    v_result := jsonb_build_object(
      'status', CASE WHEN v_claimed_at IS NOT NULL AND v_existing.user_id IS NOT NULL
                     THEN 'duplicate' ELSE 'success' END,
      'code', CASE WHEN v_existing.user_id IS NOT NULL
                   THEN 'ALREADY_CLAIMED' ELSE 'CLAIMED' END,
      'message', CASE WHEN v_existing.user_id IS NOT NULL
                      THEN 'Lunch already claimed for ' || COALESCE(v_profile.name, 'this participant') || '.'
                      ELSE 'Lunch claimed for ' || COALESCE(v_profile.name, 'participant') || '.' END,
      'user_id', v_user_id,
      'user_name', v_profile.name,
      'claimed_at', v_claimed_at);
  END IF;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO public.processed_requests (request_id, endpoint)
    VALUES (p_request_id, 'claim_person_lunch')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;
