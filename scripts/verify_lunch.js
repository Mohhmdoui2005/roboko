const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
let url, anon, service;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (k === 'NEXT_PUBLIC_SUPABASE_URL') url = val;
        if (k === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') anon = val;
        if (k === 'SUPABASE_SERVICE_ROLE_KEY') service = val;
      }
    }
  });
}

const admin = createClient(url, service);
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function verifyLunch() {
  console.log('=== VERIFYING LUNCH MODULE (PART 7) ===');

  // 0. RPCs exist?
  const { error: cntErr } = await admin.rpc('get_lunch_claim_count');
  if (cntErr && cntErr.code === 'PGRST202') {
    console.error('>> Lunch RPCs missing. Run scripts/lunch_setup.sql in the Supabase SQL editor.');
    process.exitCode = 2;
    return;
  }

  // Test subject: a profile with a server-issued lunch payload
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, lunch_qr_payload')
    .not('lunch_qr_payload', 'is', null)
    .limit(5);
  const subject = (profiles || []).find((p) => p.id && p.lunch_qr_payload);
  if (!subject) {
    console.error('>> No profile has lunch_qr_payload. Run scripts/generate_qrs.js first.');
    process.exit(2);
  }
  const { data: orga } = await admin.from('profiles').select('id').eq('role', 'ORGA').limit(1);
  const orgaId = (orga || [])[0]?.id;
  console.log(`Subject: ${subject.name || subject.id}`);

  // 1. Admin broadcast
  const startTime = new Date(Date.now() + 3600e3).toISOString();
  const t0b = Date.now();
  const { data: bc, error: bcErr } = await admin.rpc('broadcast_lunch_start', {
    p_start_time: startTime,
    p_push: true,
  });
  check('broadcast sets lunch_start_time', !bcErr && bc && !!bc.lunch_start_time, `${Date.now() - t0b}ms`);
  const { count: teamCount } = await admin.from('teams').select('*', { count: 'exact', head: true });
  check('broadcast fanned out per team', bc && bc.notified_teams === teamCount, `notified ${bc && bc.notified_teams}/${teamCount}`);

  // 2. First claim — timed (acceptance: < 500 ms end to end)
  const t0 = Date.now();
  const { data: c1, error: c1Err } = await admin.rpc('claim_person_lunch', {
    p_payload: subject.lunch_qr_payload,
    p_orga_id: orgaId || subject.id,
  });
  const ms = Date.now() - t0;
  check('first claim succeeds', !c1Err && c1 && c1.status === 'success', `${ms}ms`);
  check('scanner response under 500ms', ms < 500, `${ms}ms`);

  // 3. Duplicate — specific error WITH original timestamp (acceptance)
  const { data: c2 } = await admin.rpc('claim_person_lunch', {
    p_payload: subject.lunch_qr_payload,
    p_orga_id: orgaId || subject.id,
  });
  check(
    'duplicate returns specific ALREADY_CLAIMED (not generic)',
    c2 && c2.status === 'duplicate' && c2.code === 'ALREADY_CLAIMED',
    JSON.stringify(c2)
  );
  check('duplicate carries ORIGINAL claimed_at', c2 && c2.claimed_at === (c1 && c1.claimed_at), `${c2 && c2.claimed_at}`);

  // 4. Forged payload rejected specifically
  const forged = JSON.stringify({ domain: 'PERSON_LUNCH', user_id: subject.id, sig: 'forged' });
  const { data: cf } = await admin.rpc('claim_person_lunch', { p_payload: forged });
  check('forged QR rejected specifically', cf && cf.code === 'UNKNOWN_OR_FORGED', JSON.stringify(cf));

  // 5. Garbage + wrong domain
  const { data: cg } = await admin.rpc('claim_person_lunch', { p_payload: 'not-json-at-all' });
  check('garbage rejected as INVALID_QR', cg && cg.code === 'INVALID_QR', JSON.stringify(cg));
  const { data: cw } = await admin.rpc('claim_person_lunch', {
    p_payload: JSON.stringify({ domain: 'ROBOT_TEST', robot_id: 'x' }),
  });
  check('robot QR rejected as WRONG_DOMAIN', cw && cw.code === 'WRONG_DOMAIN', JSON.stringify(cw));

  // 6. Count + participant self-read (RLS)
  const { data: n } = await admin.rpc('get_lunch_claim_count');
  check('claim count reflects claim', n >= 1, `count=${n}`);
  const userClient = createClient(url, anon);
  const { error: signErr } = await userClient.auth.signInWithPassword({
    email: 'participant@test.com',
    password: 'password123',
  });
  if (signErr) {
    console.log(`⚠️  RLS self-read skipped (participant@test.com sign-in failed: ${signErr.message})`);
  } else {
    const { data: me } = await userClient.auth.getUser();
    const { data: own, error: ownErr } = await userClient
      .from('lunch_claims')
      .select('claimed_at')
      .eq('user_id', me.user.id)
      .maybeSingle();
    // participant@test.com may not be our subject; just verify query path works
    check('participant can read own lunch_claims row (RLS)', !ownErr, ownErr ? ownErr.message : `row=${JSON.stringify(own)}`);
    await userClient.auth.signOut();
  }

  // ── Cleanup ──
  await admin.from('lunch_claims').delete().eq('user_id', subject.id);
  await admin.from('notifications').delete().eq('type', 'LUNCH_START');
  await admin.from('tournament_state').update({ lunch_start_time: null }).not('id', 'is', null);
  const { count: rc } = await admin.from('lunch_claims').select('*', { count: 'exact', head: true }).eq('user_id', subject.id);
  check('rollback clean', rc === 0, `leftover claims=${rc}`);

  console.log(failures === 0 ? '\nALL LUNCH CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

verifyLunch();
