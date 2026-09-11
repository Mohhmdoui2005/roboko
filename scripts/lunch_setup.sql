-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: Lunch Management Module
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Design notes:
--   * Authenticity WITHOUT a server-side secret: claim_person_lunch only
--     accepts the FULL payload string when it exactly matches the
--     server-generated profiles.lunch_qr_payload for that user. Forged or
--     tampered QRs match no row → specific UNKNOWN_OR_FORGED error.
--   * One lunch per person: unique index on lunch_claims(user_id); the RPC
--     pre-checks AND catches unique_violation (race-safe), always returning
--     the ORIGINAL claimed_at on duplicates.
--   * Broadcast reuses the Part 6 notifications table: one LUNCH_START row
--     per team, which participants pick up via their existing 10 s team poll.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. lunch_start_time on the singleton tournament_state row
ALTER TABLE public.tournament_state
  ADD COLUMN IF NOT EXISTS lunch_start_time TIMESTAMPTZ;

-- 2. lunch_claims hardening
ALTER TABLE public.lunch_claims
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_lunch_claims_user_id'
  ) THEN
    CREATE UNIQUE INDEX uq_lunch_claims_user_id
      ON public.lunch_claims (user_id);
  END IF;
END $$;

-- 3. RLS: writes go through SECURITY DEFINER RPCs; clients only read.
ALTER TABLE public.lunch_claims ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lunch_claims' AND policyname = 'Participants read own lunch claim'
  ) THEN
    CREATE POLICY "Participants read own lunch claim"
      ON public.lunch_claims FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lunch_claims' AND policyname = 'Orga and admin read all lunch claims'
  ) THEN
    CREATE POLICY "Orga and admin read all lunch claims"
      ON public.lunch_claims FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role IN ('ORGA', 'ADMIN')
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tournament_state' AND policyname = 'Anyone can read tournament state'
  ) THEN
    CREATE POLICY "Anyone can read tournament state"
      ON public.tournament_state FOR SELECT USING (true);
  END IF;
END $$;

-- 4. claim_person_lunch — full scanned payload in, specific outcome out.
-- Returns JSONB: {status, code, message, user_id, user_name, claimed_at}.
--   success   — first scan, lunch claimed now
--   duplicate — already claimed; claimed_at = ORIGINAL claim timestamp
--   error     — INVALID_QR | WRONG_DOMAIN | UNKNOWN_OR_FORGED | NOT_AUTHENTICATED
CREATE OR REPLACE FUNCTION public.claim_person_lunch(
  p_payload TEXT,
  p_orga_id UUID DEFAULT NULL
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

  -- Authenticity: payload must EXACTLY match the stored server-signed payload.
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id AND lunch_qr_payload = p_payload;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error', 'code', 'UNKNOWN_OR_FORGED',
      'message', 'No lunch badge matches this QR. It may be forged, tampered, or not yet issued.',
      'user_id', v_user_id);
  END IF;

  -- Duplicate: specific answer WITH the original timestamp (scanner shows it).
  SELECT * INTO v_existing
  FROM public.lunch_claims WHERE user_id = v_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate', 'code', 'ALREADY_CLAIMED',
      'message', 'Lunch already claimed for ' || COALESCE(v_profile.name, 'this participant') || '.',
      'user_id', v_user_id,
      'user_name', v_profile.name,
      'claimed_at', v_existing.claimed_at);
  END IF;

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
    -- Lost a race with another scanner: re-read, report as duplicate.
    SELECT * INTO v_existing
    FROM public.lunch_claims WHERE user_id = v_user_id;
    RETURN jsonb_build_object(
      'status', 'duplicate', 'code', 'ALREADY_CLAIMED',
      'message', 'Lunch already claimed for ' || COALESCE(v_profile.name, 'this participant') || '.',
      'user_id', v_user_id,
      'user_name', v_profile.name,
      'claimed_at', v_existing.claimed_at);
  END;

  RETURN jsonb_build_object(
    'status', 'success', 'code', 'CLAIMED',
    'message', 'Lunch claimed for ' || COALESCE(v_profile.name, 'participant') || '.',
    'user_id', v_user_id,
    'user_name', v_profile.name,
    'claimed_at', v_claimed_at);
END;
$$;

-- 5. Claimed count for the orga display (polled every 10 s)
CREATE OR REPLACE FUNCTION public.get_lunch_claim_count()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int FROM public.lunch_claims;
$$;

-- 6. Admin control: set lunch_start_time, optionally fan-out a broadcast
-- that participants pick up via their existing notification polling.
CREATE OR REPLACE FUNCTION public.broadcast_lunch_start(
  p_start_time TIMESTAMPTZ,
  p_push BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notified INT := 0;
  v_msg TEXT;
BEGIN
  -- WHERE clause required: hosted Postgres rejects WHERE-less UPDATEs.
  UPDATE public.tournament_state
  SET lunch_start_time = p_start_time, updated_at = now()
  WHERE id IS NOT NULL;

  IF COALESCE(p_push, true) THEN
    v_msg := 'Lunch service starts at '
      || to_char(p_start_time, 'HH24:MI') || '. Show your lunch QR at the catering station.';
    INSERT INTO public.notifications (team_id, message, type)
    SELECT t.id, v_msg, 'LUNCH_START' FROM public.teams t;
    GET DIAGNOSTICS v_notified = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'lunch_start_time', p_start_time,
    'broadcast_pushed', COALESCE(p_push, true),
    'notified_teams', v_notified);
END;
$$;
