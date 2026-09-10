
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('Testing connection to:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // Try to get a non-existent table just to check network/auth
    const { data, error } = await supabase.from('_test_connection_').select('*').limit(1);
    
    // If it's a real connection error (e.g., fetch failed), it throws.
    // If it's a Postgres error (relation doesn't exist), the connection worked!
    if (error) {
      if (error.code === '42P01') {
        console.log('✅ Connection successful! (Table does not exist, which is expected)');
      } else {
        console.log('❌ Supabase error:', error.message);
      }
    } else {
      console.log('✅ Connection successful!');
    }
  } catch (err) {
    console.log('❌ Connection failed:', err.message);
  }
}

testConnection();
