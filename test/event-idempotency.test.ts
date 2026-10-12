import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/config/db';
import { runRetryCheck } from '../src/jobs/retryScheduler';
import {
  migrateTestDb, resetTables, insertFailure, getFailure, countNudgesSent,
  deliverWebhook, breakTable, restoreTable
} from './helpers';

before(() => migrateTestDb());
beforeEach(async () => {
  await restoreTable('transaction_failures');
  await restoreTable('audit_logs');
  await resetTables();
});
after(async () => {
  await restoreTable('transaction_failures');
  await restoreTable('audit_logs');
  await pool.end();
});

function linkPaidEvent(recoveryTxId: string, linkId = 'plink_test_1') {
  return {
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: linkId, amount: 95000, notes: { recovery_tx_id: recoveryTxId } } },
      payment: { entity: { id: 'pay_recovered_1', amount: 95000 } }
    }
  };
}

function paymentFailedEvent(payId: string) {
  return {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: payId, order_id: 'order_x', amount: 100000, contact: '+919876543210',
          error_code: 'BAD_REQUEST_ERROR', error_source: 'customer',
          notes: { recovery_cohort: 'treated' }
        }
      }
    }
  };
}

// Bug (a), payment received: the event was marked processed, THEN the row was
// updated. If the update failed, Razorpay's retry was rejected as a duplicate,
// so a customer who had paid stayed INTERVENING and kept getting reminders.
test('a paid event that fails mid-processing is recorded when Razorpay retries', async () => {
  const tx = await insertFailure({ status: 'INTERVENING', attempts: 1 });

  await breakTable('transaction_failures');                    // database hiccup
  const first = await deliverWebhook(linkPaidEvent(tx.id));
  assert.equal(first.status, 500, 'the failed attempt must not be acknowledged');

  await restoreTable('transaction_failures');                  // Razorpay retries the same event
  const retry = await deliverWebhook(linkPaidEvent(tx.id));

  assert.equal(retry.body?.status, 'recovery_confirmed', `retry was answered: ${JSON.stringify(retry.body)}`);
  assert.equal((await getFailure(tx.id)).status, 'RECOVERED');
});

test('a duplicate paid event is still processed only once', async () => {
  const tx = await insertFailure({ status: 'INTERVENING', attempts: 1 });

  const first = await deliverWebhook(linkPaidEvent(tx.id));
  const dup = await deliverWebhook(linkPaidEvent(tx.id));

  assert.equal(first.body?.status, 'recovery_confirmed');
  assert.equal(dup.body?.status, 'already_processed');
  const audits = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE transaction_id = $1 AND step = 'PAYMENT_RECOVERED'`, [tx.id]);
  assert.equal(audits.rows[0].n, 1);
});

// Bug (a), payment failed: the event was marked processed before the failure was
// diagnosed and nudged. If that work failed, the row sat in PENDING forever —
// the retry was a "duplicate" and the scheduler never looks at PENDING rows.
test('a failed payment whose processing breaks is eventually nudged', async () => {
  await breakTable('audit_logs');                              // processing fails partway
  await deliverWebhook(paymentFailedEvent('pay_stuck_1'));

  await restoreTable('audit_logs');
  await deliverWebhook(paymentFailedEvent('pay_stuck_1'));     // Razorpay retry

  // Time passes; make the row look old enough for the scheduler, then run it.
  await query(`UPDATE transaction_failures SET updated_at = now() - interval '1 hour' WHERE razorpay_pay_id = 'pay_stuck_1'`);
  await runRetryCheck();

  const row = (await query(`SELECT * FROM transaction_failures WHERE razorpay_pay_id = 'pay_stuck_1'`)).rows[0];
  assert.ok(row, 'the failure must have been recorded');
  assert.notEqual(row.status, 'PENDING', 'the failure must not be stuck in PENDING');
  assert.equal(await countNudgesSent(row.id), 1, 'the customer should have been nudged exactly once');
});