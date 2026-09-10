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

async function verifyPhase1Matches() {
  console.log('=== VERIFYING PHASE 1 MATCHES ===');
  
  // Call generate_phase1_matches RPC
  console.log('Calling generate_phase1_matches()...');
  const { error: genErr } = await supabase.rpc('generate_phase1_matches');
  if (genErr) {
    console.error('Error executing generate_phase1_matches:', genErr);
  }

  // Fetch qualification matches
  const { data: matches, error: fetchErr } = await supabase
    .from('matches')
    .select('id, arena_id, queue_index, status, team1_id, team2_id, is_knockout')
    .eq('is_knockout', false)
    .not('team1_id', 'is', null)
    .order('queue_index', { ascending: true });

  if (fetchErr) {
    console.error('Error fetching matches:', fetchErr);
    return;
  }

  console.log(`Total Phase 1 Qualification matches: ${matches.length}`);
  if (matches.length === 54) {
    console.log('✅ Exactly 54 matches generated.');
  } else {
    console.log(`❌ Expected 54 matches, got ${matches.length}`);
  }

  // Group by arena
  const arenaCounts = {};
  matches.forEach(m => {
    arenaCounts[m.arena_id] = (arenaCounts[m.arena_id] || 0) + 1;
  });
  console.log('Matches per arena:', arenaCounts);

  // Subphase breakdown (18 matches per subphase across 3 subphases = 54)
  const subphaseSize = 18;
  const subphases = [
    matches.slice(0, subphaseSize),
    matches.slice(subphaseSize, subphaseSize * 2),
    matches.slice(subphaseSize * 2, subphaseSize * 3)
  ];

  subphases.forEach((sub, idx) => {
    console.log(`Subphase ${idx + 1}: ${sub.length} matches`);
  });
}

verifyPhase1Matches();
