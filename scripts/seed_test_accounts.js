const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf8');
  c.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('=');
      if (i > -1) {
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[k] = v;
      }
    }
  });
}
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PASSWORD = 'Roboko123!';

const ACCOUNTS = [
  { email: 'admin@test.com', role: 'ADMIN', name: 'Admin User', arena: null },
  { email: 'orga@test.com', role: 'ORGA', name: 'Orga User', arena: null },
  { email: 'jury@test.com', role: 'JURY', name: 'Jury User', arena: 'Arena A' },
  { email: 'participant@test.com', role: 'PARTICIPANT', name: 'Participant User', arena: null },
];

async function ensureAccount({ email, role, name, arena }) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const existing = (list.users || []).find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
  let userId;
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role },
    });
    if (error) throw new Error(email + ' create failed: ' + error.message);
    userId = data.user.id;
    console.log('created ' + email);
  } else {
    userId = existing.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { ...(existing.app_metadata || {}), role },
    });
    if (updErr) throw new Error(email + ' password/role reset failed: ' + updErr.message);
    console.log('reset password + role for ' + email);
  }
  // Keep profiles table in sync (RLS uses profiles.role). Table uses `name` column.
  let teamId = null;
  if (role === 'PARTICIPANT') {
    const { data: team } = await admin.from('teams').select('id').limit(1).maybeSingle();
    teamId = team ? team.id : null;
  }
  const { error: profErr } = await admin.from('profiles').upsert({
    id: userId,
    role,
    name,
    assigned_arena: arena,
    team_id: teamId,
  });
  if (profErr) throw new Error(email + ' profile upsert failed: ' + profErr.message);

  // Verify sign-in works with anon key (what the phone browser uses)
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (signErr) throw new Error(email + ' sign-in verify failed: ' + signErr.message);
  const jwtRole = signIn.session.user.app_metadata && signIn.session.user.app_metadata.role;
  console.log('verified ' + email + ' -> JWT role=' + jwtRole);
  await anon.auth.signOut();
  return { email, role, userId, jwtRole };
}

(async () => {
  const results = [];
  for (const a of ACCOUNTS) {
    results.push(await ensureAccount(a));
  }
  console.log('\nAll accounts ready. Password for all: ' + PASSWORD);
  console.log(JSON.stringify(results.map((r) => ({ email: r.email, role: r.role, jwtRole: r.jwtRole })), null, 2));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
