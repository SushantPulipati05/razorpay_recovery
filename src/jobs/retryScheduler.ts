import { query } from '../config/db';
import { env } from '../config/env';
import { retryDueTransaction } from '../recovery/pipeline';
import { retryDelaysHours } from '../recovery/schedule';
import { TransactionFailureRow } from '../types/db';

const CHECK_INTERVAL_MS = env.NODE_ENV === 'development'
  ? 5 * 60 * 1000
  : 60 * 60 * 1000;

// Each retried transaction can make two Groq calls (diagnosis + WhatsApp copy),
// and gpt-oss-20b's on-demand tier caps at 8000 tokens/minute — firing a batch
// of due transactions back-to-back blows through that in a handful of retries.
// Spacing them out keeps a whole batch under the per-minute budget.
const RETRY_THROTTLE_MS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-entrancy guard: a single pass over a large due-transaction backlog (each
// throttled by RETRY_THROTTLE_MS) can take longer than CHECK_INTERVAL_MS,
// especially under Groq/Razorpay rate-limit retries adding latency. Without
// this guard, setInterval fires the next runRetryCheck() while the previous
// one is still mid-flight, both query the same "due" transaction before
// either has written its update back, and both dispatch a nudge to it —
// a real double-send observed in testing (same tx id, same batch, dispatched
// twice). This flag makes a new pass skip instead of overlapping.
let isRunning = false;

export async function runRetryCheck(): Promise<void> {
  if (isRunning) {
    console.log('[RetryScheduler] Previous check still running — skipping this cycle to avoid double-dispatch.');
    return;
  }
  isRunning = true;
  console.log('[RetryScheduler] Running retry check...');

  try {
    const delays = retryDelaysHours();
    const attempt1Cutoff = new Date(Date.now() - delays.attempt1 * 60 * 60 * 1000);
    const attempt2Cutoff = new Date(Date.now() - delays.attempt2 * 60 * 60 * 1000);

    const result = await query<TransactionFailureRow>(
      `SELECT * FROM transaction_failures
       WHERE attempts_count < 3
         AND status NOT IN ('RECOVERED', 'HALTED_EXHAUSTED', 'HOLDOUT')
         AND (
           (status = 'DEFERRED' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
           OR
           (status = 'PROMISE_TO_PAY' AND promise_at IS NOT NULL AND promise_at <= NOW())
           OR
           (status = 'INTERVENING' AND (
             (attempts_count = 1 AND updated_at < $1) OR
             (attempts_count = 2 AND updated_at < $2)
           ))
         )
       ORDER BY COALESCE(next_retry_at, promise_at, updated_at) ASC
       LIMIT 20`,
      [attempt1Cutoff, attempt2Cutoff]
    );

    if (result.rows.length === 0) {
      console.log('[RetryScheduler] No transactions due for retry.');
      return;
    }

    console.log(`[RetryScheduler] Found ${result.rows.length} transaction(s) due for follow-up.`);

    for (let i = 0; i < result.rows.length; i++) {
      const tx = result.rows[i];
      try {
        const out = await retryDueTransaction(tx);
        console.log(`[RetryScheduler] tx ${tx.id} → ${out.status} (${out.recoveryStatus})`);
      } catch (err: any) {
        console.error(`[RetryScheduler] Error retrying tx ${tx.id}: ${err.message}`);
      }
      if (i < result.rows.length - 1) {
        await sleep(RETRY_THROTTLE_MS);
      }
    }
  } catch (err: any) {
    console.error(`[RetryScheduler] Query error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

export function startRetryScheduler(): NodeJS.Timeout {
  const intervalMinutes = CHECK_INTERVAL_MS / 60000;
  const delays = retryDelaysHours();
  console.log(`[RetryScheduler] Started. Checking every ${intervalMinutes} minute(s).`);
  console.log(`[RetryScheduler] Retry delays — attempt 1: ${delays.attempt1 * 60}min, attempt 2: ${delays.attempt2 * 60}min`);
  runRetryCheck();
  return setInterval(runRetryCheck, CHECK_INTERVAL_MS);
}
