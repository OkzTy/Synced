const { createClient } = require('@libsql/client');

async function main() {
  const db = createClient({
    url: 'libsql://synced-db-okzty.aws-eu-west-1.turso.io',
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODE0MzEwNDksImlkIjoiMDE5ZWM1OTAtNTkwMS03NGVhLTllMmYtYTNiZTNhMDk4ZjQ0IiwicmlkIjoiMGQzYTFjYTgtNTI1OC00NzA5LWFlYWItYzI0ZThmNzNmNGQwIn0._pKYAKZTwvkWmcF44VCmjblNoaBThhsusF9hgKIQzb_tqaxWEJccn3iuFgGP8dptqva4IZ9fAirI3FaJec7sBQ',
  });

  try {
    // Test connection
    const result = await db.execute('SELECT 1 as test');
    console.log('✅ DB Connected');

    // List users
    const users = await db.execute('SELECT id, username, is_admin, created_at, license_key FROM users');
    console.log(`\n📋 Users (${users.rows.length}):`);
    for (const u of users.rows) {
      console.log(`   [${u.id}] ${u.username} | admin:${u.is_admin} | created:${u.created_at} | license:${u.license_key || 'none'}`);
    }

    // List license keys
    const keys = await db.execute('SELECT id, key, type, is_active, created_at FROM license_keys');
    console.log(`\n🔑 License Keys (${keys.rows.length}):`);
    for (const k of keys.rows) {
      console.log(`   [${k.id}] ${k.key} | type:${k.type} | active:${k.is_active} | created:${k.created_at}`);
    }

    // Check auth_events
    const events = await db.execute('SELECT COUNT(*) as count FROM auth_events');
    console.log(`\n📝 Auth events: ${events.rows[0]?.count || 0}`);

    // Check account_events
    const accEvents = await db.execute('SELECT COUNT(*) as count FROM account_events');
    console.log(`📝 Account events: ${accEvents.rows[0]?.count || 0}`);

  } catch (e) {
    console.error('❌ Diagnostic failed:', e.message);
    console.error(e);
  }
}

main();
