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

async function verifyWarnings() {
  console.log('=== VERIFYING WARNINGS (PART 11+12: decrement, 3-warning forfeit, per-round reset) ===');

  // 0. New signatures exist? Probe first — exit before touching any data.
  const probe = await s.rpc('decrement_warning', {
    p_match_id: '00000000-0000-0000-0000-000000000000',
    p_team_id: '00000000-0000-0000-0000-000000000000',
    p_request_id: crypto.randomUUID(),
  });
  if (probe.error && probe.error.code === 'PGRST202') {
    console.error('>> decrement_warning missing. Run scripts/warning_update.sql in the Supabase SQL editor.');
    process.exitCode = 2;
    return;
  }

  // Setup: two temp teams + one temp match (offender = team1).
  const tag = `VERIFY_W_${Date.now()}`;
  const t1 = await s.from('teams').insert({ name: `${tag}_A` }).select('id').single();
  const t2 = await s.from('teams').insert({ name: `${tag}_B` }).select('id').single();
  if (t1.error || t2.error) throw new Error(`team setup failed: ${t1.error?.message} ${t2.error?.message}`);
  const mm = await s.from('matches').insert({
    arena_id: 'Arena A',
    queue_index: 999998,
    subphase: 1,
    team1_id: t1.data.id,
    team2_id: t2.data.id,
    status: 'PUBLISHED',
    current_round: 1,
    warnings_team1: 0,
    warnings_team2: 0,
    is_knockout: false,
    phase: 'QUALIFICATION',
  }).select('id').single();
  if (mm.error) throw new Error(`match setup failed: ${mm.error.message}`);
  const mid = mm.data.id;

  try {
    // 1-2. First two warnings: counts rise, no forfeit.
    const w1 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    const w2 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    check('warning 1 → count 1, no forfeit', w1.data?.warnings_team1 === 1 && w1.data?.forfeit == null, JSON.stringify(w1.data));
    check('warning 2 → count 2, no forfeit', w2.data?.warnings_team1 === 2 && w2.data?.forfeit == null, JSON.stringify(w2.data));

    // 3. Decrement works mid-round: 2 → 1.
    const dec0 = await s.rpc('decrement_warning', { p_match_id: mid, p_team_id: t1.data.id });
    check('decrement 2 → 1', dec0.data?.warnings_team1 === 1, JSON.stringify(dec0.data));

    // 4. Back to 3 → forfeit round 1 (team1 0 vs team2 1), counters reset.
    await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    const w3 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    check('warning 3 → count 3 + forfeit applied',
      w3.data?.warnings_team1 === 3 && w3.data?.forfeit?.applied === true && w3.data?.forfeit?.round_number === 1,
      JSON.stringify(w3.data));
    const { data: fr } = await s.from('match_rounds').select('round_number,team1_result,team2_result')
      .eq('match_id', mid).eq('round_number', 1).maybeSingle();
    check('forfeit round recorded 0-1', fr?.team1_result === 0 && fr?.team2_result === 1, JSON.stringify(fr));
    const { data: ma } = await s.from('matches').select('current_round,status,warnings_team1,warnings_team2').eq('id', mid).single();
    check('match advanced to round 2, counters reset 0-0',
      ma?.current_round === 2 && ma?.warnings_team1 === 0 && ma?.warnings_team2 === 0, JSON.stringify(ma));

    // 5. Fresh allowance next round: 3 more warnings → forfeit round 2.
    await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    const w6 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t1.data.id });
    check('round 2 also allows 3 warnings, then forfeits',
      w6.data?.forfeit?.applied === true && w6.data?.forfeit?.round_number === 2, JSON.stringify(w6.data));
    const { data: ma2 } = await s.from('matches').select('current_round,warnings_team1').eq('id', mid).single();
    check('match advanced to round 3, counters reset again',
      ma2?.current_round === 3 && ma2?.warnings_team1 === 0, JSON.stringify(ma2));

    // 6. Retry same request_id → deduped, no second forfeit.
    const rid = crypto.randomUUID();
    const d1 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t2.data.id, p_request_id: rid });
    const d2 = await s.rpc('increment_warning', { p_match_id: mid, p_team_id: t2.data.id, p_request_id: rid });
    check('retry flagged deduped, counted once',
      d1.data?.deduped === false && d2.data?.deduped === true && d2.data?.warnings_team2 === 1,
      JSON.stringify(d2.data));

    // 7. Floor: decrement past 0 stays 0.
    await s.rpc('decrement_warning', { p_match_id: mid, p_team_id: t1.data.id });
    const floor = await s.rpc('decrement_warning', { p_match_id: mid, p_team_id: t1.data.id });
    check('warnings floor at 0', floor.data?.warnings_team1 === 0, JSON.stringify(floor.data));

    // 8. Ledger holds the explicit request_id.
    const { data: led } = await s.from('processed_requests').select('request_id').eq('request_id', rid);
    check('processed_requests ledger recorded', (led || []).length === 1, '');
    await s.from('processed_requests').delete().eq('request_id', rid);
  } finally {
    // Cleanup: rounds → match → teams (temp rows only).
    await s.from('match_rounds').delete().eq('match_id', mid);
    await s.from('matches').delete().eq('id', mid);
    await s.from('teams').delete().eq('id', t1.data.id);
    await s.from('teams').delete().eq('id', t2.data.id);
  }

  console.log(failures === 0 ? '\nAll warning checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

verifyWarnings().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
