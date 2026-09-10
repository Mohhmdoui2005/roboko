const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Simple .env.local reader without external deps
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const qrSecretKey = process.env.QR_SECRET_KEY || 'supersecretkey123';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase URL or Service Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function generateRobotPayload(robotId) {
  return JSON.stringify({
    domain: 'ROBOT_TEST',
    robot_id: robotId,
  });
}

function generatePersonPayload(userId) {
  const baseData = {
    domain: 'PERSON_LUNCH',
    user_id: userId,
  };
  const serialized = JSON.stringify(baseData);
  const hmac = crypto.createHmac('sha256', qrSecretKey);
  hmac.update(serialized);
  const sig = hmac.digest('hex');

  return JSON.stringify({
    ...baseData,
    sig,
  });
}

async function main() {
  console.log('Generating QR payloads for robots...');
  const { data: robots, error: robotsError } = await supabase.from('robots').select('id, name');
  if (robotsError) {
    console.error('Error fetching robots:', robotsError);
  } else if (!robots || robots.length === 0) {
    console.log('No robots found.');
  } else {
    for (const robot of robots) {
      const payload = generateRobotPayload(robot.id);
      const { error: updateError } = await supabase
        .from('robots')
        .update({ qr_payload: payload })
        .eq('id', robot.id);
      if (updateError) {
        console.error(`Error updating robot ${robot.id}:`, updateError);
      } else {
        console.log(`Updated robot "${robot.name || robot.id}" with payload.`);
      }
    }
  }

  console.log('\nGenerating QR payloads for profiles...');
  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id');
  if (profilesError) {
    console.error('Error fetching profiles:', profilesError);
  } else if (!profiles || profiles.length === 0) {
    console.log('No profiles found.');
  } else {
    for (const profile of profiles) {
      const payload = generatePersonPayload(profile.id);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ lunch_qr_payload: payload })
        .eq('id', profile.id);
      if (updateError) {
        console.error(`Error updating profile ${profile.id}:`, updateError);
      } else {
        console.log(`Updated profile ${profile.id} with payload.`);
      }
    }
  }
  console.log('\nFinished generating QR payloads.');
}

main().catch(console.error);
