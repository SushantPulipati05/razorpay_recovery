const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true }); // suppress dotenv's own promotional console output

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/razor_recover';

async function initDb() {
  console.log('--- Initializing Database for razorpay-recover ---');
  console.log(`Connecting with DATABASE_URL: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch (err) {
    console.error('Invalid DATABASE_URL format:', err.message);
    process.exit(1);
  }

  const targetDbName = parsedUrl.pathname.replace(/^\//, '') || 'razor_recover';
  const host = parsedUrl.hostname || 'localhost';
  const port = parseInt(parsedUrl.port || '5432', 10);
  const user = decodeURIComponent(parsedUrl.username || 'postgres');
  const password = decodeURIComponent(parsedUrl.password || 'postgres');

  // Step 1: Connect to default maintenance database 'postgres' to check/create target database
  const maintenanceClient = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres'
  });

  try {
    await maintenanceClient.connect();
    console.log(`[1/3] Connected to maintenance database 'postgres' on ${host}:${port}.`);

    const checkRes = await maintenanceClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDbName]
    );

    if (checkRes.rowCount === 0) {
      console.log(`[2/3] Database '${targetDbName}' does not exist. Creating...`);
      // Escape targetDbName safely as identifier
      await maintenanceClient.query(`CREATE DATABASE "${targetDbName}"`);
      console.log(`Database '${targetDbName}' created successfully.`);
    } else {
      console.log(`[2/3] Database '${targetDbName}' already exists.`);
    }
  } catch (err) {
    console.error('Error checking/creating database:', err.message);
    console.error('Tip: If password authentication failed, verify the password in your .env DATABASE_URL.');
    await maintenanceClient.end().catch(() => {});
    process.exit(1);
  } finally {
    await maintenanceClient.end().catch(() => {});
  }

  // Step 2: Connect to target database 'razor_recover' and execute schema/schema.sql
  const targetClient = new Client({
    host,
    port,
    user,
    password,
    database: targetDbName
  });

  try {
    await targetClient.connect();
    console.log(`Connected to target database '${targetDbName}'.`);

    const schemaPath = path.join(__dirname, '..', 'schema', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log(`[3/3] Executing schema from ${schemaPath}...`);

    await targetClient.query(schemaSql);
    console.log('Base schema executed. Applying column migrations...');

    const migrations = [
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recovery_status') THEN
           ALTER TABLE transaction_failures ALTER COLUMN status DROP DEFAULT;
           ALTER TABLE transaction_failures
             ALTER COLUMN status TYPE VARCHAR(40) USING status::text;
           DROP TYPE recovery_status;
         END IF;
       END $$`,
      `ALTER TABLE transaction_failures ALTER COLUMN status SET DEFAULT 'PENDING'`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(255)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS is_holdout BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS loss_mode VARCHAR(40) DEFAULT 'PAYMENT_FAILED'`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS error_code VARCHAR(100)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS error_description TEXT`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS error_step VARCHAR(100)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS preferred_method VARCHAR(40)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS rule_strategy VARCHAR(100)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS groq_strategy VARCHAR(100)`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS diagnosis_disagreed BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS promise_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE transaction_failures ADD COLUMN IF NOT EXISTS defer_reason VARCHAR(100)`,
      `CREATE INDEX IF NOT EXISTS idx_tf_payment_link ON transaction_failures(payment_link_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tf_next_retry ON transaction_failures(next_retry_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tf_promise_at ON transaction_failures(promise_at)`
    ];

    for (const sql of migrations) {
      await targetClient.query(sql);
    }

    console.log('Schema executed successfully:');
    console.log(' - Table: transaction_failures (with holdout, defer, payment_link attribution)');
    console.log(' - Table: audit_logs');
    console.log(' - Table: processed_events');
    console.log('--- Database Initialization Complete ---');
  } catch (err) {
    console.error('Error executing schema:', err.message);
    process.exit(1);
  } finally {
    await targetClient.end().catch(() => {});
  }
}

initDb();
