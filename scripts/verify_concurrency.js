
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyConcurrency() {
  console.log('--- Testing Concurrency & Idempotency ---');
  const requestId = `test-req-${Date.now()}`;
  
  // We need an existing robot_id. For testing, we'll fetch the seed robot.
  const { data: robots } = await supabase.from('robots').select('id').limit(1);
  if (!robots || robots.length === 0) {
    console.error('No robots found. Make sure you seeded the database.');
    return;
  }
  const robotId = robots[0].id;
  
  console.log(`Simulating 3 simultaneous QR scans for robot: ${robotId} with request_id: ${requestId}`);
  
  // Fire 3 simultaneous RPC requests with the SAME request_id
  const promises = [
    supabase.rpc('start_test_session', { p_robot_id: robotId, p_request_id: requestId }),
    supabase.rpc('start_test_session', { p_robot_id: robotId, p_request_id: requestId }),
    supabase.rpc('start_test_session', { p_robot_id: robotId, p_request_id: requestId })
  ];

  const results = await Promise.all(promises);

  console.log('\nResults from simultaneous calls:');
  results.forEach((res, index) => {
    if (res.error) {
      console.error(`Call ${index + 1} Error:`, res.error.message);
    } else {
      console.log(`Call ${index + 1} Success! Returned session ID:`, res.data.id);
    }
  });

  // Verify only ONE session was actually created
  const { data: sessions, error } = await supabase
    .from('test_sessions')
    .select('id')
    .eq('request_id', requestId);

  if (error) throw error;

  console.log('\nFinal DB State:');
  console.log(`Total sessions created for request_id '${requestId}': ${sessions.length}`);
  
  if (sessions.length === 1) {
    console.log('✅ Concurrency check passed: Exactly one session created. The function is atomic and idempotent.');
  } else {
    console.log('❌ Concurrency check failed: Race condition detected.');
  }
}

verifyConcurrency().catch(console.error);
