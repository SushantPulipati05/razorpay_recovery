/**
 * Judge demo: 20 payment failures + subscription + overdue invoice.
 * Holdout, strategy divergence, payment_link.paid attribution, lift vs control.
 *
 * Requires: npm run init-db && npm run dev
 * Run: npm run test:batch
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true }); // suppress dotenv's own promotional console output

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_12345';
// Swap this to whatever number you've joined to the Twilio WhatsApp sandbox
// and added as a verified caller ID, so nudges actually deliver to a real phone.
const DEMO_PHONE = '+919324592512';

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

async function postWebhook(body: object): Promise<any> {
  const raw = JSON.stringify(body);
  const res = await fetch(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(raw) },
    body: raw
  });
  return res.json();
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failedPayment(opts: {
  payId: string;
  orderId: string;
  amountPaise: number;
  errorCode: string;
  errorDescription: string;
  errorSource: string;
  errorReason: string;
  cohort: 'treated' | 'holdout';
  forceQuietHours?: boolean;
}) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    entity: 'event',
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: opts.payId,
          amount: opts.amountPaise,
          currency: 'INR',
          status: 'failed',
          order_id: opts.orderId,
          contact: DEMO_PHONE,
          email: 'judge@example.com',
          error_code: opts.errorCode,
          error_description: opts.errorDescription,
          error_source: opts.errorSource,
          error_step: 'payment_authorization',
          error_reason: opts.errorReason,
          notes: {
            recovery_cohort: opts.cohort,
            ...(opts.forceQuietHours ? { force_quiet_hours: true } : {})
          },
          created_at: ts
        }
      }
    },
    created_at: ts
  };
}

function subscriptionFailed(payId: string, subId: string, amountPaise: number) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    entity: 'event',
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: subId, notes: { recovery_cohort: 'treated' } } },
      payment: {
        entity: {
          id: payId,
          amount: amountPaise,
          status: 'failed',
          order_id: subId,
          contact: DEMO_PHONE,
          email: 'member@example.com',
          error_code: 'GATEWAY_ERROR',
          error_description: 'Issuer bank is temporarily unavailable — timed out',
          error_source: 'bank',
          error_reason: 'bank_system_error',
          notes: { recovery_cohort: 'treated' },
          created_at: ts
        }
      }
    },
    created_at: ts
  };
}

function linkPaid(linkId: string, orderId: string, txId: string, amountPaise: number, payId: string) {
  return {
    entity: 'event',
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: linkId,
          amount: amountPaise,
          notes: { original_order_id: orderId, recovery_tx_id: txId }
        }
      },
      payment: {
        entity: {
          id: payId,
          amount: amountPaise,
          status: 'captured',
          order_id: `order_link_${payId}`
        }
      }
    }
  };
}

function organicCapture(orderId: string, amountPaise: number, payId: string) {
  return {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: payId,
          amount: amountPaise,
          status: 'captured',
          order_id: orderId
        }
      }
    }
  };
}

async function run() {
  console.log('razorpay-recover — Track 03 batch demo\n');

  const health = await get('/health');
  if (health.database !== 'connected') {
    console.error('PostgreSQL is not connected. Run npm run init-db and npm run dev first.');
    process.exit(1);
  }

  const stamp = Date.now();
  const results: Array<{ kind: string; status: string; strategy?: string }> = [];

  for (let i = 0; i < 8; i++) {
    const holdout = i >= 6;
    const out = await postWebhook(failedPayment({
      payId: `pay_bank_${stamp}_${i}`,
      orderId: `order_bank_${stamp}_${i}`,
      amountPaise: 350000,
      errorCode: 'GATEWAY_ERROR',
      errorDescription: 'Issuer bank is temporarily unavailable — timed out',
      errorSource: 'bank',
      errorReason: 'bank_system_error',
      cohort: holdout ? 'holdout' : 'treated'
    }));
    results.push({ kind: holdout ? 'bank-holdout' : 'bank', status: out.status, strategy: out.aiDiagnosis?.strategy });
    await sleep(4000); // stay under gpt-oss-20b's real 8000 TPM/minute cap across the batch
  }

  for (let i = 0; i < 6; i++) {
    const holdout = i >= 4;
    const out = await postWebhook(failedPayment({
      payId: `pay_drop_${stamp}_${i}`,
      orderId: `order_drop_${stamp}_${i}`,
      amountPaise: 250000,
      errorCode: 'BAD_REQUEST_ERROR',
      errorDescription: 'Payment cancelled by user after OTP screen',
      errorSource: 'customer',
      errorReason: 'payment_authentication_failed',
      cohort: holdout ? 'holdout' : 'treated'
    }));
    results.push({ kind: holdout ? 'drop-holdout' : 'drop', status: out.status, strategy: out.aiDiagnosis?.strategy });
    await sleep(4000);
  }

  for (let i = 0; i < 4; i++) {
    const holdout = i >= 2;
    const out = await postWebhook(failedPayment({
      payId: `pay_nsf_${stamp}_${i}`,
      orderId: `order_nsf_${stamp}_${i}`,
      amountPaise: 180000,
      errorCode: 'INSUFFICIENT_FUNDS',
      errorDescription: 'insufficient funds on the account',
      errorSource: 'customer',
      errorReason: 'insufficient_funds',
      cohort: holdout ? 'holdout' : 'treated'
    }));
    results.push({ kind: holdout ? 'nsf-holdout' : 'nsf', status: out.status, strategy: out.aiDiagnosis?.strategy });
    await sleep(4000);
  }

  for (let i = 0; i < 2; i++) {
    const out = await postWebhook(failedPayment({
      payId: `pay_fraud_${stamp}_${i}`,
      orderId: `order_fraud_${stamp}_${i}`,
      amountPaise: 990000,
      errorCode: 'FRAUD_CHECK',
      errorDescription: 'suspicious activity flagged by issuer',
      errorSource: 'issuer',
      errorReason: 'fraud',
      cohort: 'treated'
    }));
    results.push({ kind: 'fraud', status: out.status, strategy: out.aiDiagnosis?.strategy });
    await sleep(4000);
  }

  const subOut = await postWebhook(subscriptionFailed(`pay_sub_${stamp}`, `sub_${stamp}`, 49900));
  results.push({ kind: 'subscription', status: subOut.status, strategy: subOut.aiDiagnosis?.strategy });

  // TRAI quiet-hours guardrail, forced to fire live regardless of the wall clock
  // (see notes.force_quiet_hours in webhooks/razorpayHandler.ts) — otherwise this
  // only demonstrates itself for real between 9pm-9am IST.
  const quietOut = await postWebhook(failedPayment({
    payId: `pay_quiet_${stamp}`,
    orderId: `order_quiet_${stamp}`,
    amountPaise: 199900,
    errorCode: 'BAD_REQUEST_ERROR',
    errorDescription: 'Payment cancelled by user after OTP screen',
    errorSource: 'customer',
    errorReason: 'payment_authentication_failed',
    cohort: 'treated',
    forceQuietHours: true
  }));
  results.push({ kind: 'trai-quiet-hours', status: quietOut.status, strategy: quietOut.aiDiagnosis?.strategy });

  const invRes = await fetch(`${BASE}/api/ingest/receivable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-secret': SECRET },
    body: JSON.stringify({
      invoiceId: `INV-${stamp}`,
      amount: 12500,
      customerPhone: DEMO_PHONE,
      daysOverdue: 21,
      cohort: 'treated'
    })
  });
  const invOut = await invRes.json();
  results.push({ kind: 'invoice', status: invOut.status, strategy: invOut.aiDiagnosis?.strategy });

  await fetch(`${BASE}/api/jobs/retry-now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ releaseDeferred: true })
  });

  const failures = await get('/api/failures');
  const rows = failures.data || [];
  const recoverTargets = rows
    .filter((r: any) => r.status === 'INTERVENING' && !r.is_holdout && r.payment_link_id)
    .slice(0, 4);

  for (const tx of recoverTargets) {
    const amountPaise = Math.round((Number(tx.original_amount) - Number(tx.total_discount_given)) * 100);
    await postWebhook(linkPaid(
      tx.payment_link_id,
      tx.razorpay_order_id,
      tx.id,
      amountPaise,
      `pay_recov_${tx.id.replace(/-/g, '').slice(0, 12)}`
    ));
  }

  const holdout = rows.find((r: any) => r.is_holdout || r.status === 'HOLDOUT');
  if (holdout) {
    await postWebhook(organicCapture(
      holdout.razorpay_order_id,
      Math.round(Number(holdout.original_amount) * 100),
      `pay_organic_${stamp}`
    ));
  }

  console.log('Ingest outcomes:');
  for (const r of results) {
    console.log(`  ${r.kind.padEnd(16)} ${String(r.status).padEnd(24)} ${r.strategy || ''}`);
  }

  const summary = await get('/api/summary');
  console.log('\nMeasured batch (treat vs holdout):');
  console.log(`  Failures:              ${summary.total_failures}`);
  console.log(`  Treated recovered:     ${summary.treated_recovered}/${summary.treated_count} (${summary.treated_recovery_rate_percent}%)`);
  console.log(`  Holdout recovered:     ${summary.holdout_recovered}/${summary.holdout_count} (${summary.holdout_recovery_rate_percent}%)`);
  console.log(`  Lift:                  ${summary.lift_percentage_points} pp`);
  console.log(`  Incremental revenue:   ₹${summary.incremental_revenue}`);
  console.log(`  Amount recovered:      ₹${summary.total_recovered_amount}`);
  console.log(`  Discount given:        ₹${summary.total_discount_given}`);
  console.log(`  Ops cost:              ₹${summary.total_cost_incurred}`);
  console.log(`  Net recovered (₹):     ₹${summary.net_revenue_saved}`);
  console.log(`  Deferred:              ${summary.deferred}`);
  console.log(`  Fraud/exhausted halt:  ${summary.halted_exhausted}`);
  console.log(`\nTRAI quiet-hours guardrail (forced for demo): status=${quietOut.status} reason=${quietOut.reason}`);
  if (summary.strategy_lift?.length) {
    console.log('\nLift by strategy:');
    for (const s of summary.strategy_lift) {
      console.log(
        `  ${s.strategy.padEnd(34)} treated ${s.treated_recovered}/${s.treated_count} (${s.treated_rate_percent}%)` +
        `  holdout ${s.holdout_recovered}/${s.holdout_count} (${s.holdout_rate_percent}%)` +
        `  lift ${s.lift_percentage_points}pp  ₹${s.incremental_revenue}`
      );
    }
  }
  console.log(`\nDiagnosis disagreements (Groq overruled by conservative rules): ${summary.diagnosis_disagreements}`);
  console.log('\nNow run: npx ts-node scripts/test-promise-to-pay.ts   (Hinglish promise-to-pay pause/wake demo)');
  console.log('Then open dashboard/ and walk one audit trail end to end.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
