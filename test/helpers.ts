import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { query } from '../src/config/db';
import { TransactionFailureRow } from '../src/types/db';

/** Creates the test database if needed and applies the schema (idempotent). */
export function migrateTestDb(): void {
  // Tests are run from the project root (npm run test:db), so resolve from there.
  execFileSync(process.execPath, [path.join(process.cwd(), 'scripts', 'init-db.js')], {
    env: process.env,
    stdio: 'ignore'
  });
}

/** Empties every table so each test starts from a known state. */
export async function resetTables(): Promise<void> {
  await query('TRUNCATE audit_logs, transaction_failures, processed_events CASCADE');
}

let seq = 0;

/** Inserts a failed payment in a given state and returns the row. */
export async function insertFailure(overrides: {
  status?: string;
  attempts?: number;
  errorCode?: string;
  amount?: number;
} = {}): Promise<TransactionFailureRow> {
  seq++;
  const res = await query<TransactionFailureRow>(
    `INSERT INTO transaction_failures
       (razorpay_pay_id, razorpay_order_id, customer_phone, original_amount,
        failure_reason, failure_source, status, attempts_count, error_code, loss_mode)
     VALUES ($1, $2, '+919876543210', $3, 'payment_failed', 'customer', $4, $5, $6, 'PAYMENT_FAILED')
     RETURNING *`,
    [
      `pay_test_${Date.now()}_${seq}`,
      `order_test_${seq}`,
      overrides.amount ?? 1000,
      overrides.status ?? 'INTERVENING',
      overrides.attempts ?? 0,
      // A generic decline: classified as CUSTOMER_DROP (sends a nudge immediately).
      overrides.errorCode ?? 'BAD_REQUEST_ERROR'
    ]
  );
  return res.rows[0];
}

export async function getFailure(id: string): Promise<TransactionFailureRow> {
  const res = await query<TransactionFailureRow>('SELECT * FROM transaction_failures WHERE id = $1', [id]);
  return res.rows[0];
}

/** How many nudges were actually dispatched for a transaction, from its audit trail. */
export async function countNudgesSent(id: string): Promise<number> {
  const res = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE transaction_id = $1
       AND (step LIKE 'MANUAL_NUDGE_ATTEMPT_%' OR step LIKE 'RETRY_NUDGE_ATTEMPT_%' OR step = 'RECOVERY_NUDGE_DISPATCHED')`,
    [id]
  );
  return res.rows[0].n;
}