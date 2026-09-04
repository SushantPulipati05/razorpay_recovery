/**
 * Wipes transaction/audit data without dropping the database or re-running
 * schema migrations — useful when you've changed the demo phone number (or
 * anything else) and want a clean slate instead of old rows with the old
 * value still sitting around and getting retried.
 *
 * Run: npm run reset-db
 */
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/razor_recover';

async function resetDb() {
  console.log('--- Resetting razorpay-recover data ---');
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query('TRUNCATE transaction_failures, audit_logs, processed_events RESTART IDENTITY CASCADE');
    console.log('Cleared: transaction_failures, audit_logs, processed_events.');
    console.log('Schema and migrations untouched — re-run npm run test:batch to seed fresh data.');
  } catch (err) {
    console.error('Error resetting data:', err.message);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

resetDb();
