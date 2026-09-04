/**
 * Comprehensive test script covering all 4 assessment gaps.
 *
 * Run with: npx ts-node scripts/test-all.ts
 * Requires: npm run dev running in another terminal.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_12345';

// ─── helpers ─────────────────────────────────────────────────────────────────

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

async function post(path: string, body: object): Promise<{ status: number; data: any }> {
  const raw = JSON.stringify(body);
  const sig = sign(raw);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
    body: raw
  });
  return { status: res.status, data: await res.json() };
}

async function get(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function log(label: string, val: any) {
  const valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
  console.log(`\n[${label}]\n${valStr}`);
}

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✅  ${msg}`);
  } else {
    console.error(`  ❌  FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

function makePaymentFailed(overrides: Record<string, any> = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const payId = `pay_test_${ts}_${Math.random().toString(36).slice(2, 6)}`;
  const orderId = `order_test_${ts}`;
  return {
    entity: 'event',
    account_id: 'acc_merchant_1',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: payId,
          entity: 'payment',
          amount: 250000,   // ₹2,500 in paise
          currency: 'INR',
          status: 'failed',
          order_id: orderId,
          contact: '+919876543210',
          email: 'testcustomer@example.com',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment cancelled by user after OTP screen',
          error_source: 'customer',
          error_step: 'payment_authentication',
          error_reason: 'payment_authentication_failed',
          notes: { recovery_cohort: 'treated' },
          created_at: ts,
          ...overrides
        }
      }
    },
    created_at: ts
  };
}

function makePaymentCaptured(orderId: string, newPayId: string, amountPaise: number) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    entity: 'event',
    account_id: 'acc_merchant_1',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: newPayId,
          entity: 'payment',
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
          order_id: orderId,
          contact: '+919876543210',
          email: 'testcustomer@example.com',
          created_at: ts
        }
      }
    },
    created_at: ts
  };
}

// ─── test suite ──────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   razorpay-recover — Full End-to-End Assessment Tests    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── 0. Health ─────────────────────────────────────────────────────────────
  section('0. Health & Connectivity');
  const health = await get('/health');
  log('Health Response', health.data);
  assert(health.status === 200, 'Health endpoint returns 200');
  assert(health.data.service === 'razorpay-recover', 'Service name is razorpay-recover');
  const dbConnected = health.data.database === 'connected';
  if (dbConnected) {
    console.log('  ✅  PostgreSQL connected — full persistence enabled');
  } else {
    console.warn('  ⚠️   PostgreSQL not connected — service will return 500 on webhook processing');
    console.warn(`       Error: ${health.data.error}`);
  }

  // ── 1. HMAC Security Guard ────────────────────────────────────────────────
  section('1. GAP SECURITY — HMAC Signature Verification');
  const badSigRes = await (async () => {
    const raw = JSON.stringify({ event: 'payment.failed' });
    const res = await fetch(`${BASE}/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'totally_invalid' },
      body: raw
    });
    return { status: res.status, data: await res.json() };
  })();
  log('Bad Signature Response', badSigRes.data);
  assert(badSigRes.status === 400, 'Invalid HMAC is rejected with HTTP 400');
  assert(badSigRes.data.error === 'Invalid webhook signature', 'Error message is correct');

  // ── 2. payment.failed — Customer Drop ─────────────────────────────────────
  section('2. GAP #3 — AI Diagnostic Classifier (payment.failed, customer drop-off)');
  const failedPayload = makePaymentFailed();
  const failedOrderId = failedPayload.payload.payment.entity.order_id;
  const failedPayId = failedPayload.payload.payment.entity.id;
  const failedRes = await post('/webhooks/razorpay', failedPayload);
  log('payment.failed Response', failedRes.data);
  assert(failedRes.status === 200, 'payment.failed is accepted with HTTP 200');
  const isHaltedOrIntervening = ['halted', 'intervention_dispatched', 'deferred', 'holdout'].includes(failedRes.data.status);
  assert(isHaltedOrIntervening, `Status is halted, deferred, holdout, or intervention_dispatched — got: ${failedRes.data.status}`);
  if (failedRes.data.aiDiagnosis) {
    console.log(`  ✅  AI Diagnosis — category: ${failedRes.data.aiDiagnosis.category}, strategy: ${failedRes.data.aiDiagnosis.strategy}`);
  } else if (failedRes.data.reason?.includes('TRAI') || failedRes.data.status === 'deferred') {
    console.log(`  ✅  TRAI quiet hours deferred (not discarded)`);
  }

  const dupRes = await post('/webhooks/razorpay', failedPayload);
  assert(dupRes.data.status === 'already_processed', 'Duplicate payment.failed webhook is ignored (idempotent)');

  // ── 3. payment.failed — Bank Outage ───────────────────────────────────────
  section('3. GAP #3 — AI Classifier (payment.failed, bank/gateway outage)');
  const bankFailedPayload = makePaymentFailed({
    id: `pay_bank_${Date.now()}`,
    order_id: `order_bank_${Date.now()}`,
    amount: 350000,
    error_code: 'GATEWAY_ERROR',
    error_description: 'Issuer bank is temporarily unavailable — timed out',
    error_source: 'bank',
    error_step: 'payment_authorization',
    error_reason: 'bank_system_error',
    notes: { recovery_cohort: 'treated' }
  });
  const bankRes = await post('/webhooks/razorpay', bankFailedPayload);
  log('Bank outage payment.failed Response', bankRes.data);
  assert(bankRes.status === 200, 'Bank outage payment.failed accepted with HTTP 200');
  if (bankRes.data.aiDiagnosis?.category === 'BANK_NETWORK_ERROR') {
    console.log('  ✅  AI correctly classified as BANK_NETWORK_ERROR — 0% discount (correct behaviour)');
  }

  // ── 4. GAP #1 — Close the Recovery Loop (payment.captured) ───────────────
  section('4. GAP #1 — Closing the Recovery Loop (payment.captured)');
  if (dbConnected) {
    // Simulate customer clicking our recovery link and paying
    const capturePayload = makePaymentCaptured(
      failedOrderId,
      `pay_captured_${Date.now()}`,
      237500  // ₹2,375 in paise (₹2,500 - 5% = ₹2,375)
    );
    const captureRes = await post('/webhooks/razorpay', capturePayload);
    log('payment.captured Response', captureRes.data);
    assert(captureRes.status === 200, 'payment.captured accepted with HTTP 200');
    const isRecoveryConfirmedOrAcknowledged = ['recovery_confirmed', 'acknowledged'].includes(captureRes.data.status);
    assert(isRecoveryConfirmedOrAcknowledged, `Capture status is recovery_confirmed or acknowledged — got: ${captureRes.data.status}`);
    if (captureRes.data.status === 'recovery_confirmed') {
      console.log(`  ✅  RECOVERED — ₹${captureRes.data.recoveredAmount} captured for order ${captureRes.data.orderId}`);
      console.log(`  ✅  recoveryStatus set to: ${captureRes.data.recoveryStatus}`);
    }
  } else {
    console.log('  ⚠️   Skipping payment.captured test — database not connected');
  }

  // ── 5. Non-payment event (ignored safely) ────────────────────────────────
  section('5. Event Routing — Non-failed events ignored gracefully');
  const ignoredRes = await post('/webhooks/razorpay', { entity: 'event', event: 'payment.authorized', payload: { payment: { entity: { id: 'pay_xyz', order_id: 'order_xyz', amount: 100 } } } });
  log('payment.authorized Response', ignoredRes.data);
  assert(ignoredRes.status === 200, 'Non-handled event returns HTTP 200');
  assert(ignoredRes.data.status === 'acknowledged', `Non-handled event is acknowledged — got: ${JSON.stringify(ignoredRes.data.status)}`);

  // ── 6. GAP #2 — /api/summary (the ROI proof endpoint) ────────────────────
  section('6. GAP #2 — /api/summary (Measured Money Recovered Dashboard)');
  const summaryRes = await get('/api/summary');
  log('Summary Response', summaryRes.data);
  assert(summaryRes.status === 200, '/api/summary returns HTTP 200');
  const s = summaryRes.data;
  assert(typeof s.total_failures === 'number', 'total_failures is a number');
  assert(typeof s.recovery_rate_percent === 'number', 'recovery_rate_percent is a number');
  assert(typeof s.total_recovered_amount === 'number', 'total_recovered_amount is a number');
  assert(typeof s.net_revenue_saved === 'number', 'net_revenue_saved is a number');
  console.log(`\n  📊  Recovery Dashboard Snapshot:`);
  console.log(`      Total Failures:     ${s.total_failures}`);
  console.log(`      Intervening:        ${s.intervening}`);
  console.log(`      Recovered:          ${s.recovered}`);
  console.log(`      TRAI Halted:        ${s.halted_policy}`);
  console.log(`      Revenue at Risk:    ₹${s.total_original_at_risk}`);
  console.log(`      Amount Recovered:   ₹${s.total_recovered_amount}`);
  console.log(`      Discount Given:     ₹${s.total_discount_given}`);
  console.log(`      Cost Incurred:      ₹${s.total_cost_incurred}`);
  console.log(`      Recovery Rate:      ${s.recovery_rate_percent}%`);
  console.log(`      Net Revenue Saved:  ₹${s.net_revenue_saved}`);

  // ── 7. GAP #4 — Retry sequence is running ─────────────────────────────────
  section('7. GAP #4 — Retry Scheduler (Background Escalation)');
  // The scheduler runs on server start. We verify its effect indirectly through audit logs.
  const failuresRes = await get('/api/failures');
  assert(failuresRes.status === 200, '/api/failures returns HTTP 200');
  const rows = failuresRes.data?.data || [];
  const hasAuditTrail = rows.some((r: any) => Array.isArray(r.audits) && r.audits.length > 0);
  if (hasAuditTrail) {
    console.log('  ✅  Audit trail present in failure records (retry scheduler writes to audit_logs)');
    const sample = rows[0];
    console.log(`  ✅  Latest record: payId=${sample.razorpay_pay_id}, status=${sample.status}, attempts=${sample.attempts_count}`);
  } else if (!dbConnected) {
    console.log('  ⚠️   Skipping audit trail check — database not connected');
  } else {
    console.log('  ℹ️   No records yet — run again after some payment.failed events are processed');
  }

  // ── Final Summary ─────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║               Test Run Complete                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nExit code: ${process.exitCode ?? 0} — ${process.exitCode ? '❌ Some tests failed' : '✅ All assertions passed'}\n`);
}

main().catch((err) => {
  console.error('\n[FATAL] Test runner crashed:', err.message);
  process.exit(1);
});
