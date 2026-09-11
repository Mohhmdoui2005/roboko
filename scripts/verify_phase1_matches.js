const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const supabase = createClient(url, key);
const pairKey = (a, b) => [a, b].sort().join('|');
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function verifyPhase1Matches() {
  console.log('=== VERIFYING PHASE 1 MATCHES (PART 6 acceptance #1) ===');

  console.log('Calling generate_phase1_matches()...');
  const { data: genData, error: genErr } = await supabase.rpc('generate_phase1_matches');
  if (genErr) {
    console.error('RPC error:', genErr.message);
    console.error('>> Run scripts/phase1_setup.sql then scripts/generate_phase1_matches.sql in the Supabase SQL editor.');
    process.exit(2);
  }
  console.log('RPC return:', JSON.stringify(genData));

  let matches;
  {
    const full = await supabase
      .from('matches')
      .select('id, arena_id, queue_index, subphase, status, team1_id, team2_id, is_knockout')
      .eq('is_knockout', false)
      .order('arena_id', { ascending: true })
      .order('queue_index', { ascending: true });
    if (full.error && full.error.code === '42703') {
      console.error('>> DB schema is stale (missing Phase 1 columns).');
      console.error('>> Run scripts/phase1_setup.sql then scripts/generate_phase1_matches.sql in the Supabase SQL editor, then re-run this script.');
      process.exit(2);
    }
    if (full.error) {
      console.error('Error fetching matches:', full.error.message || full.error);
      process.exit(2);
    }
    matches = full.data;
  }

  if (genData === null) {
    console.log('NOTE: generate_phase1_matches() returned null (old void stub?) — results below reflect CURRENT table state.');
  }

  // 1. Exactly 54
  check('Exactly 54 qualification matches', matches.length === 54, `got ${matches.length}`);

  // 2. Zero repeated pairings globally
  const keys = matches.map((m) => pairKey(m.team1_id, m.team2_id));
  const dupes = keys.length - new Set(keys).size;
  check('Zero repeated pairings (global)', dupes === 0, `${dupes} duplicates`);

  // 3. Per subphase: 18 matches, zero repeats within subphase
  for (const s of [1, 2, 3]) {
    const sub = matches.filter((m) => m.subphase === s);
    const sk = sub.map((m) => pairKey(m.team1_id, m.team2_id));
    const sd = sk.length - new Set(sk).size;
    check(`Subphase ${s}: 18 matches, 0 repeats`, sub.length === 18 && sd === 0, `${sub.length} matches, ${sd} dupes`);
  }

  // 4. Per arena: contiguous queues 1..N (N varies: 14/14/13/13), zero repeats
  const arenas = [...new Set(matches.map((m) => m.arena_id))].sort();
  console.log('Arenas:', arenas.join(', '));
  let arenaTotal = 0;
  for (const a of arenas) {
    const am = matches.filter((m) => m.arena_id === a);
    arenaTotal += am.length;
    const queues = am.map((m) => m.queue_index).sort((x, y) => x - y);
    const queueOk = queues.length > 0 && queues.every((q, i) => q === i + 1);
    const ak = am.map((m) => pairKey(m.team1_id, m.team2_id));
    const ad = ak.length - new Set(ak).size;
    check(`${a}: ${am.length} matches, queues 1..${am.length}, 0 repeats`, queueOk && ad === 0, `queues [${queues.slice(0, 3)}…${queues.slice(-1)}], ${ad} dupes`);
  }
  check('Per-arena counts sum to 54', arenaTotal === 54, `sum=${arenaTotal}`);

  // 5. All start PENDING at round 1
  const pending = matches.filter((m) => m.status === 'PENDING').length;
  check('All matches start PENDING', pending === matches.length, `${pending}/${matches.length} pending`);

  // 6. Workload balance: every team plays the same number of matches
  // (36 teams → exactly 3 each) against distinct opponents.
  const teamIds = [...new Set(matches.flatMap((m) => [m.team1_id, m.team2_id]))];
  const counts = {};
  const opponents = {};
  teamIds.forEach((id) => { counts[id] = 0; opponents[id] = new Set(); });
  matches.forEach((m) => {
    counts[m.team1_id]++;
    counts[m.team2_id]++;
    opponents[m.team1_id].add(m.team2_id);
    opponents[m.team2_id].add(m.team1_id);
  });
  const vals = Object.values(counts);
  const minC = Math.min(...vals);
  const maxC = Math.max(...vals);
  const distinctOk = Object.values(opponents).every((s) => s.size === maxC);
  const balanced = teamIds.length === 36
    ? (minC === 3 && maxC === 3 && distinctOk)
    : (maxC - minC <= 1 && distinctOk);
  const worst = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => `${id.slice(0, 8)}×${n}`).join(', ');
  check(
    `Balanced workload (${teamIds.length} teams, min ${minC} / max ${maxC} matches, distinct opponents)`,
    balanced, teamIds.length === 36 ? `expected exactly 3 each — most loaded: ${worst}` : `most loaded: ${worst}`
  );

  // 7. Per subphase: every team plays exactly once (36 teams → 18 pairs)
  let subBalanceOk = true;
  for (const s of [1, 2, 3]) {
    const sub = matches.filter((m) => m.subphase === s);
    const seen = sub.flatMap((m) => [m.team1_id, m.team2_id]);
    if (new Set(seen).size !== seen.length) subBalanceOk = false;
  }
  check('Each team plays exactly once per subphase', subBalanceOk, '');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

verifyPhase1Matches();
