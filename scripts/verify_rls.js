const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTestUser(email, role, name, arena, teamId) {
  // Check if exists
  const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
  const user = existing?.users?.find((u) => u.email === email);
  
  let userId;
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'password123',
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  } else {
    userId = user.id;
  }

  // Ensure profile is correctly set (the RLS uses this)
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: userId,
    role,
    name,
    assigned_arena: arena,
    team_id: teamId
  });
  
  if (profileError) throw profileError;

  return userId;
}

async function verifyRLS() {
  console.log('--- Testing RLS Policies ---');

  // Seed a team
  const { data: team } = await supabaseAdmin.from('teams').select('id').limit(1);
  const teamId = team[0]?.id;

  // 1. Create Test Users
  const adminId = await createTestUser('admin@test.com', 'ADMIN', 'Admin User', null, null);
  const orgaId = await createTestUser('orga@test.com', 'ORGA', 'Orga User', null, null);
  const juryAId = await createTestUser('jurya@test.com', 'JURY', 'Jury Arena A', 'Arena A', null);
  const juryBId = await createTestUser('juryb@test.com', 'JURY', 'Jury Arena B', 'Arena B', null);
  const participantId = await createTestUser('participant@test.com', 'PARTICIPANT', 'Participant User', null, teamId);

  // Helper to create a client for a specific user
  async function getClientForUser(email) {
    // We sign in with email/password to get the session JWT
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data, error } = await client.auth.signInWithPassword({ email, password: 'password123' });
    if (error) throw error;
    return client;
  }

  // 2. Test RLS on Matches table
  console.log('\nTesting RLS: Matches Table');
  
  const adminClient = await getClientForUser('admin@test.com');
  const juryAClient = await getClientForUser('jurya@test.com');
  const juryBClient = await getClientForUser('juryb@test.com');
  const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  // Admin should be able to create a match
  console.log('Action: Admin creating a match for Arena A');
  const { data: match, error: matchError } = await adminClient.from('matches').insert({
    arena_id: 'Arena A',
    queue_index: 100,
    status: 'PENDING'
  }).select().single();
  
  if (matchError) console.error('❌ Admin failed to create match:', matchError.message);
  else console.log('✅ Admin successfully created match');

  const matchId = match.id;

  // Jury A should be able to read it
  const { data: juryAMatch } = await juryAClient.from('matches').select('id').eq('id', matchId);
  if (juryAMatch?.length > 0) console.log('✅ Jury A can read Arena A match');
  else console.log('❌ Jury A CANNOT read Arena A match');

  // Jury B should NOT be able to read it (assuming it's pending)
  const { data: juryBMatch } = await juryBClient.from('matches').select('id').eq('id', matchId);
  if (juryBMatch?.length === 0) console.log('✅ Jury B cannot read Arena A match (as expected)');
  else console.log('❌ Jury B can read Arena A match (RLS leak)');

  // Public should NOT be able to read it (because it's PENDING)
  const { data: publicMatch } = await publicClient.from('matches').select('id').eq('id', matchId);
  if (publicMatch?.length === 0) console.log('✅ Public cannot read PENDING match (as expected)');
  else console.log('❌ Public can read PENDING match (RLS leak)');

  // Admin publishes match
  await adminClient.from('matches').update({ status: 'PUBLISHED' }).eq('id', matchId);
  
  // Public SHOULD now be able to read it
  const { data: publicMatchAfter } = await publicClient.from('matches').select('id').eq('id', matchId);
  if (publicMatchAfter?.length > 0) console.log('✅ Public CAN read PUBLISHED match');
  else console.log('❌ Public cannot read PUBLISHED match');

  console.log('\n--- RLS Verification Complete ---');
}

verifyRLS().catch(console.error);
