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

// Win a match 2-0 for team1 via the jury RPC (server advances, client idle)
async function winMatch2_0(matchId) {
  for (const round of [1, 2]) {
    const { error } = await s.rpc('submit_match_round', {
      p_match_id: matchId,
      p_request_id: crypto.randomUUID(),
      p_round_number: round,
      p_team1_result: 1,
      p_team2_result: 0,
    });
    if (error) return error.message;
  }
  return null;
}

async function verifyKnockout() {
  console.log('=== VERIFYING KNOCKOUT ENGINE (PART 8) ===');

  const { error: seedErr } = await s.rpc('get_knockout_seeds');
  if (seedErr && seedErr.code === 'PGRST202') {
    console.error('>> Knockout RPCs missing. Run scripts/knockout_setup.sql in the Supabase SQL editor.');
    process.exitCode = 2;
    return;
  }
  const { data: seeds } = await s.rpc('get_knockout_seeds');
  check('top-16 seeds computed', seeds && seeds.length === 16, `${seeds && seeds.length} seeds`);

  // Publish
  const { data: pub, error: pubErr } = await s.rpc('publish_knockout_bracket', {
    p_seeds: seeds.map((x) => x.team_id),
  });
  check('publish_knockout_bracket ok', !pubErr, pubErr ? pubErr.message : JSON.stringify(pub));
  if (pubErr) {
    console.log('>> Publish failed — aborting (no cleanup needed).');
    process.exit(1);
  }

  const { data: nodes } = await s.from('bracket_nodes').select('*').order('ko_stage', { ascending: false }).order('position');
  check('16 bracket_nodes created', nodes && nodes.length === 16, `${nodes && nodes.length}`);
  const perStage = {};
  (nodes || []).forEach((n) => { perStage[n.ko_stage] = (perStage[n.ko_stage] || 0) + 1; });
  check('stage split 8/4/2/1/1', JSON.stringify(perStage) === JSON.stringify({ 1: 1, 2: 1, 4: 2, 8: 4, 16: 8 }), JSON.stringify(perStage));

  const { data: kom } = await s.from('matches').select('*').eq('is_knockout', true).order('queue_index');
  check('15 knockout matches', kom && kom.length === 15, `${kom && kom.length}`);
  check('all KO matches PUBLISHED + phase KNOCKOUT',
    (kom || []).every((m) => m.status === 'PUBLISHED' && m.phase === 'KNOCKOUT'));
  const arenas = [...new Set((kom || []).map((m) => m.arena_id))].sort();
  check('arena allocation spans 4 arenas', arenas.length === 4, arenas.join(','));

  const { data: ts } = await s.from('tournament_state').select('knockout_live').limit(1).single();
  check('tournament_state.knockout_live = true', ts && ts.knockout_live === true);

  const matchOf = (stage, pos) => {
    const n = nodes.find((x) => x.ko_stage === stage && x.position === pos);
    return kom.find((m) => m.id === (n && n.match_id));
  };

  // R16 → QF auto-advance (server only; this script only reads back)
  for (let i = 0; i < 8; i++) {
    const err = await winMatch2_0(matchOf(16, i).id);
    if (err) { check(`R16 match ${i} completes`, false, err); break; }
  }
  const { data: qf } = await s.from('matches').select('*').eq('is_knockout', true);
  const q = (pos) => {
    const n = nodes.find((x) => x.ko_stage === 8 && x.position === pos);
    return qf.find((m) => m.id === (n && n.match_id));
  };
  const qfFilled = [0, 1, 2, 3].every((p) => q(p).team1_id && q(p).team2_id);
  check('QF slots auto-filled after R16 (no client logic)', qfFilled,
    [0, 1, 2, 3].map((p) => `${q(p).team1_id ? '✓' : '✗'}${q(p).team2_id ? '✓' : '✗'}`).join(' '));
  // Winners pair correctly: QF0 = winners of R16-0 (seeds[0]) and R16-1 (seeds[2])
  check('QF0 = seeds[0] vs seeds[2]', q(0).team1_id === seeds[0].team_id && q(0).team2_id === seeds[2].team_id);

  // QF → SF → Final → Champion
  for (let i = 0; i < 4; i++) await winMatch2_0(q(i).id);
  const { data: m2 } = await s.from('matches').select('*').eq('is_knockout', true);
  const at = (stage, pos) => {
    const n = nodes.find((x) => x.ko_stage === stage && x.position === pos);
    return m2.find((mm) => mm.id === (n && n.match_id));
  };
  check('SF slots auto-filled after QF', at(4, 0).team1_id && at(4, 1).team2_id);
  for (let i = 0; i < 2; i++) await winMatch2_0(at(4, i).id);
  const { data: m3 } = await s.from('matches').select('*').eq('is_knockout', true);
  const fin = (() => {
    const n = nodes.find((x) => x.ko_stage === 2 && x.position === 0);
    return m3.find((mm) => mm.id === (n && n.match_id));
  })();
  check('Final auto-filled after SF', fin.team1_id === seeds[0].team_id && !!fin.team2_id);
  await winMatch2_0(fin.id);
  const { data: m4 } = await s.from('matches').select('*').eq('is_knockout', true);
  const finDone = (() => {
    const n = nodes.find((x) => x.ko_stage === 2 && x.position === 0);
    return m4.find((mm) => mm.id === (n && n.match_id));
  })();
  check('Champion = seeds[0] (team1 won every match 2-0)', finDone.winner_id === seeds[0].team_id, `winner=${finDone.winner_id}`);

  // ── Cleanup ──
  await s.from('match_rounds').delete().in('match_id', kom.map((m) => m.id));
  await s.from('matches').delete().eq('is_knockout', true);
  await s.from('bracket_nodes').delete().not('id', 'is', null);
  await s.from('tournament_state').update({ knockout_live: false }).not('id', 'is', null);
  const { count: nc } = await s.from('bracket_nodes').select('*', { count: 'exact', head: true });
  check('rollback clean', nc === 0, `leftover nodes=${nc}`);

  console.log(failures === 0 ? '\nALL KNOCKOUT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

verifyKnockout();
