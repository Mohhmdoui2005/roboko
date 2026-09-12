const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.resolve(__dirname, '../.env.local');
let url, key;
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
        if (k === 'SUPABASE_SERVICE_ROLE_KEY') key = val;
      }
    }
  });
}

const s = createClient(url, key);
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function verifyTesting() {
  console.log('=== VERIFYING TEST SESSIONS (PART 12) ===');

  // 0. Signatures exist? Probe first — exit before touching any data.
  // 1-arg call must match (orga scanner shape); zero UUID → 'Robot not found'
  // raise proves the function exists. PGRST202 means migration not applied.
  const probe = await s.rpc('start_test_session', {
    p_robot_id: '00000000-0000-0000-0000-000000000000',
  });
  if (probe.error && probe.error.code === 'PGRST202') {
    console.error('>> start_test_session(p_robot_id) missing. Run scripts/testing_setup.sql in the Supabase SQL editor.');
    process.exitCode = 2;
    return;
  }

  // Pre-clean leftovers from interrupted runs (temp rows only).
  const staleRobots = await s.from('robots').delete().like('name', 'VERIFY_T_%').select('id');
  await s.from('teams').delete().like('name', 'VERIFY_T_%').select('id');
  if ((staleRobots.data || []).length > 0) console.log(`cleaned ${(staleRobots.data || []).length} stale temp robot(s)`);

  // Setup: temp team + robot.
  const tag = `VERIFY_T_${Date.now()}`;
  const t = await s.from('teams').insert({ name: tag }).select('id').single();
  if (t.error) throw new Error(`team setup failed: ${t.error.message}`);
  const r = await s.from('robots').insert({ name: `${tag}_bot`, team_id: t.data.id, qr_payload: JSON.stringify({ domain: 'ROBOT_TEST', robot_id: `verify-${Date.now()}` }) }).select('id').single();
  if (r.error) throw new Error(`robot setup failed: ${r.error.message}`);
  const robotId = r.data.id;
  let sessionId = null;

  try {
    // 1. Server time shape.
    const st = await s.rpc('get_server_time');
    check('get_server_time returns now', !!st.data?.now && !isNaN(new Date(st.data.now).getTime()), JSON.stringify(st.data));

    // 2. Start: success + 5-minute slot + arena assigned.
    const s1 = await s.rpc('start_test_session', { p_robot_id: robotId });
    const slotMin = s1.data ? (new Date(s1.data.ends_at) - new Date(s1.data.started_at)) / 60000 : NaN;
    check('start returns success + Test arena + ~5min slot',
      s1.data?.status === 'success' && /^Test [1-8]$/.test(s1.data?.arena_id || '') && Math.abs(slotMin - 5) < 0.5,
      JSON.stringify(s1.data));
    sessionId = s1.data?.session_id;

    // 3. Double start (other request): single live row, duplicate status.
    const s2 = await s.rpc('start_test_session', { p_robot_id: robotId });
    const { data: live } = await s.from('test_sessions').select('id').is('ended_at', null).eq('robot_id', robotId);
    check('double start keeps one live row, duplicate status',
      (live || []).length === 1 && s2.data?.status === 'duplicate' && s2.data?.session_id === sessionId,
      JSON.stringify(s2.data));

    // 4. Same request_id replay → deduped.
    const rid = crypto.randomUUID();
    await s.rpc('end_test_session', { p_session_id: sessionId });
    const q1 = await s.rpc('start_test_session', { p_robot_id: robotId, p_request_id: rid });
    const q2 = await s.rpc('start_test_session', { p_robot_id: robotId, p_request_id: rid });
    sessionId = q1.data?.session_id;
    check('replay deduped, same session',
      q1.data?.deduped === false && q2.data?.deduped === true && q2.data?.session_id === sessionId,
      JSON.stringify(q2.data));

    // 5. get_active_sessions lists it.
    const act = await s.rpc('get_active_sessions');
    const found = (act.data || []).find((x) => x.session_id === sessionId);
    check('get_active_sessions lists live session',
      !!found && found.robot_id === robotId && typeof found.robot_name === 'string',
      `count=${(act.data || []).length}`);

    // 6. End: gone from active list.
    const e1 = await s.rpc('end_test_session', { p_session_id: sessionId });
    const act2 = await s.rpc('get_active_sessions');
    check('end removes session from active list',
      e1.data?.status === 'success' && !(act2.data || []).some((x) => x.session_id === sessionId),
      JSON.stringify(e1.data));
    sessionId = null;

    // 7. Ending twice errors honestly.
    const e2 = await s.rpc('end_test_session', { p_session_id: q1.data.session_id });
    check('double end rejected', !!e2.error, e2.error?.message || 'no error');

    // 8. Team quota: 2 sessions used (s1 + q1) → 3rd start rejected.
    const q3 = await s.rpc('start_test_session', { p_robot_id: robotId });
    check('3rd session rejected with exhausted message',
      !!q3.error && /exhausted|no more testing/i.test(q3.error.message),
      q3.error?.message || JSON.stringify(q3.data));

    // 9. Retry of an already-counted session still dedupes past quota.
    const q4 = await s.rpc('start_test_session', { p_robot_id: robotId, p_request_id: rid });
    check('retry still dedupes past quota',
      q4.data?.deduped === true && q4.data?.session_id === q1.data.session_id,
      JSON.stringify(q4.data));
  } finally {
    // Cleanup: sessions → robot → team (temp rows only).
    await s.from('test_sessions').delete().eq('robot_id', robotId);
    await s.from('robots').delete().eq('id', robotId);
    await s.from('teams').delete().eq('id', t.data.id);
  }

  console.log(failures === 0 ? '\nAll testing checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

verifyTesting().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
