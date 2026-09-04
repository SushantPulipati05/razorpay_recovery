/**
 * Judge demo: promise-to-pay as a pause/wake state, parsed straight out of a
 * Hinglish WhatsApp reply — no separate voice/chat UI, just the same channel
 * the recovery nudge went out on.
 *
 * This posts directly to /webhooks/twilio-reply with the same form-encoded
 * shape Twilio sends for "a message comes in", so it proves the feature works
 * without needing a public URL / ngrok / Twilio console configuration for
 * the demo. Point Twilio's WhatsApp sandbox at that same route for the live
 * version.
 *
 * Requires: npm run init-db && npm run dev, and at least one INTERVENING
 * transaction on the PHONE below — `npm run test:batch` creates plenty.
 * Run: npx ts-node scripts/test-promise-to-pay.ts
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true }); // suppress dotenv's own promotional console output

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}`;
// Keep this in sync with DEMO_PHONE in scripts/test-batch.ts.
const PHONE = '+919324592512';

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function postReply(body: string): Promise<void> {
  await fetch(`${BASE}/webhooks/twilio-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: `whatsapp:${PHONE}`, Body: body }).toString()
  });
}

async function findOpenTx(): Promise<any | null> {
  const failures = await get('/api/failures');
  const rows = failures.data || [];
  return (
    rows.find((r: any) => r.customer_phone === PHONE && r.status === 'INTERVENING') || null
  );
}

async function run() {
  console.log('razorpay-recover — promise-to-pay pause/wake demo\n');

  const health = await get('/health');
  if (health.database !== 'connected') {
    console.error('PostgreSQL is not connected. Run npm run init-db and npm run dev first.');
    process.exit(1);
  }

  const before = await findOpenTx();
  if (!before) {
    console.error(
      `No INTERVENING transaction found for ${PHONE}. Run "npm run test:batch" first, then re-run this script.`
    );
    process.exit(1);
  }

  console.log(`Found open recovery: order ${before.razorpay_order_id} (attempts ${before.attempts_count}/3)`);

  const reply = 'Bhai abhi busy hu, kal kar dunga payment';
  console.log(`\nSimulating inbound WhatsApp reply from ${PHONE}:`);
  console.log(`  "${reply}"`);
  await postReply(reply);

  const failures = await get('/api/failures');
  const row = (failures.data || []).find((r: any) => r.id === before.id);

  console.log(`\nTransaction ${row.razorpay_order_id} status is now: ${row.status}`);
  console.log(`Promise parsed for: ${row.promise_at}`);

  const relevantAudits = (row.audits || []).filter((a: any) =>
    ['PROMISE_TO_PAY_RECORDED', 'INBOUND_REPLY_UNRECOGNIZED'].includes(a.step)
  );
  console.log('\nAudit trail entry:');
  for (const a of relevantAudits) {
    console.log(`  [${a.step}] ${a.reasoning}`);
  }

  console.log('\nNo further nudges will fire for this transaction until the promised time.');
  console.log('The retry scheduler (or POST /api/jobs/retry-now) wakes it automatically once promise_at passes.');
  console.log('\nAlso try replies the parser deliberately refuses to guess at, e.g. "maybe later" —');
  console.log('it logs INBOUND_REPLY_UNRECOGNIZED and leaves status untouched rather than inventing a date.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
