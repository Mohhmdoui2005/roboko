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

async function verifyOffline() {
  console.log('=== VERIFYING OFFLINE IDEMPOTENCY (PART 10) ===');

  // 0. New signatures exist?
  const probe = await s.rpc('increment_warning', {
    p_match_id: '00000000-0000-0000-0000-000000000000',
    p_team_id: '00000000-0000-0000-0000-000000000000',
    p_request_id: crypto.randomUUID(),
  });
  if (probe.error && probe.error.code === 'PGRST202') {
    console.error('>> request_id RPCs missing. Run scripts/offline_setup.sql in the Supabase SQL editor.');
    process.exitCode = 2;
    return;
  }

  // 1. Warning double-fire, same request_id → counted ONCE
  const { data: m } = await s.from('matches').select('id,team1_id,warnings_team1')
    .eq('is_knockout', false).eq('arena_id', 'Arena A').eq('queue_index', 1).single();
  const before = m.warnings_team1 ?? 0;
  const rid = crypto.randomUUID();
  const w1 = await s.rpc('increment_warning', { p_match_id: m.id, p_team_id: m.team1_id, p_request_id: rid });
  const w2 = await s.rpc('increment_warning', { p_match_id: m.id, p_team_id: m.team1_id, p_request_id: rid });
  const { data: after } = await s.from('matches').select('warnings_team1').eq('id', m.id).single();
  check('warning counted exactly once across retry', after.warnings_team1 === before + 1, `${before} → ${after.warnings_team1}`);
  check('retry flagged deduped', w2.data && w2.data.deduped === true && w1.data.deduped === false, JSON.stringify(w2.data));

  // 2. Claim replay, same request_id → single row, duplicate on replay
  const { data: profs } = await s.from('profiles').select('id,lunch_qr_payload').not('lunch_qr_payload', 'is', null).limit(3);
  const subj = (profs || [])[0];
  const { data: orga } = await s.from('profiles').select('id').eq('role', 'ORGA').limit(1);
  const orgaId = (orga || [])[0]?.id || subj.id;
  const crid = crypto.randomUUID();
  const c1 = await s.rpc('claim_person_lunch', { p_payload: subj.lunch_qr_payload, p_orga_id: orgaId, p_request_id: crid });
  const c2 = await s.rpc('claim_person_lunch', { p_payload: subj.lunch_qr_payload, p_orga_id: orgaId, p_request_id: crid });
  const { count: rows } = await s.from('lunch_claims').select('*', { count: 'exact', head: true }).eq('user_id', subj.id);
  check('claim replay creates no second row', rows === 1, `rows=${rows}`);
  check('claim replay returns duplicate+original ts', c2.data && c2.data.status === 'duplicate' && c2.data.claimed_at === c1.data.claimed_at);

  // 3. Ledger recorded both request_ids
  const { data: led } = await s.from('processed_requests').select('request_id').in('request_id', [rid, crid]);
  check('processed_requests ledger has both ids', (led || []).length === 2, `found=${(led || []).length}`);

  // ── Cleanup ──
  await s.from('lunch_claims').delete().eq('user_id', subj.id);
  await s.from('matches').update({ warnings_team1: before }).eq('id', m.id);
  await s.from('processed_requests').delete().in('request_id', [rid, crid]);
  console.log('cleanup done');

  console.log(failures === 0 ? '\nALL OFFLINE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

verifyOffline();
