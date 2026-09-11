// Burst test for src/lib/liveSig.ts: 20k synthetic realtime events —
// only snapshots with VISIBLE changes may trigger a render.
// Run: npx tsc scripts/soak_sig_helper.ts ... (simplest: compile lib first)
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const lib = 'C:\\Users\\LENOVO\\Desktop\\roboko cursor\\kind of claud\\tournament-app\\src\\lib\\liveSig.ts';
const outDir = 'C:\\Users\\LENOVO\\AppData\\Local\\Temp\\opencode\\sigtest';
fs.mkdirSync(outDir, { recursive: true });
execSync(`npx tsc "${lib}" --outDir "${outDir}" --module commonjs --target es2020`, {
  cwd: 'C:\\Users\\LENOVO\\Desktop\\roboko cursor\\kind of claud\\tournament-app',
  stdio: 'pipe',
});
const { shouldRerender } = require(path.join(outDir, 'liveSig.js'));

// Base snapshot: 54 matches + 36 board rows + 16 nodes
const matches = Array.from({ length: 54 }, (_, i) => ({
  id: `m${i}`, status: 'IN_PROGRESS', team1_id: `t${i}a`, team2_id: `t${i}b`, winner_id: null,
}));
const board = Array.from({ length: 36 }, (_, i) => ({ team_id: `t${i}`, wins: 0, matches_played: 1 }));
const nodes = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, match_id: `km${i}` }));
const base = { knockoutLive: false, matches, board, nodes };

let renders = 0;
let sig = null;
let current = base; // cumulative visible state, like the real screen
const t0 = Date.now();
// 20k events: 19,990 no-ops (warning-style noise), 10 real completions
for (let i = 0; i < 20000; i++) {
  let snap = current;
  if (i % 2000 === 0) {
    const k = i / 2000;
    snap = {
      ...current,
      matches: current.matches.map((m, j) => (j === k ? { ...m, winner_id: m.team1_id, status: 'COMPLETED' } : m)),
    };
    current = snap;
  }
  const r = shouldRerender(sig, snap);
  sig = r.sig;
  if (r.render) renders++;
}
const ms = Date.now() - t0;
// Noise that must NOT render: same snapshot twice, reordered-but-identical
const r1 = shouldRerender(sig, current);
const reordered = { ...current, matches: [...current.matches].reverse() };
const r2 = shouldRerender(r1.sig, reordered);
console.log(`20k events in ${ms}ms → renders: ${renders} (expected ≤ 10)`);
console.log(`repeat snapshot renders: ${r1.render} (expected false)`);
console.log(`reordered-but-identical renders: ${r2.render} (expected false)`);
const ok = renders <= 10 && !r1.render && !r2.render;
console.log(ok ? 'SIG BURST TEST PASSED' : 'SIG BURST TEST FAILED');
process.exit(ok ? 0 : 1);
