import { DateTime } from 'luxon';
import { query } from '../config/db';
import { DiagnosticClassifier } from '../agent/diagnosticClassifier';
import { RecoveryAgent } from '../agent/recoveryAgent';
import { PolicyEngine } from '../guardrails/policyEngine';
import { RazorpayLinkService } from '../integrations/razorpayLink';
import { WhatsAppService } from '../integrations/whatsapp';
import { assignCohort, RecoveryCohort } from './cohort';
import { nsfDeferHours } from './schedule';
import {
  DiagnosedStrategy,
  DiagnosticResult,
  LossMode,
  RecoverySummary,
  StrategyLiftRow,
  TransactionFailureRow
} from '../types/db';
import { parsePromiseReply } from './promiseToPay';

export const NUDGE_COST = 0.05;

export interface FailureIngest {
  eventKey: string;
  payId: string;
  orderId: string;
  customerPhone: string;
  customerEmail: string | null;
  originalAmount: number;
  failureReason: string;
  failureSource: string;
  errorCode?: string;
  errorDescription?: string;
  errorStep?: string;
  lossMode: LossMode;
  forceCohort?: RecoveryCohort;
  forceQuietHours?: boolean;
}

export interface IngestResult {
  status: string;
  transactionId?: string;
  recoveryStatus?: string;
  reason?: string;
  alreadyProcessed?: boolean;
  aiDiagnosis?: { category: string; strategy: string };
  paymentLink?: string;
  copySource?: string;
  whatsappStatus?: string;
  approvedDiscount?: number;
  attemptsCount?: number;
  cohort?: RecoveryCohort;
  nextRetryAt?: string;
}

async function audit(txId: string, step: string, reasoning: string, cost = 0): Promise<void> {
  await query(
    `INSERT INTO audit_logs (transaction_id, step, reasoning, cost_incurred) VALUES ($1, $2, $3, $4)`,
    [txId, step, reasoning, cost]
  );
}

export async function claimEvent(eventKey: string): Promise<boolean> {
  const result = await query(
    `INSERT INTO processed_events (event_key) VALUES ($1) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
    [eventKey]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Statuses from which a nudge may be sent. A manual (dashboard) resend must
 * never override a customer's promise to pay or a halted/finished recovery;
 * the scheduler may resume PROMISE_TO_PAY once the promised time has passed.
 */
function nudgeableStatuses(opts: { manual?: boolean }): string[] {
  return opts.manual
    ? ['PENDING', 'INTERVENING', 'DEFERRED']
    : ['PENDING', 'INTERVENING', 'DEFERRED', 'PROMISE_TO_PAY'];
}

function checkoutMethods(strategy: DiagnosedStrategy): { upi: boolean; card: boolean; netbanking: boolean; wallet: boolean } {
  if (strategy === 'BANK_OUTAGE_ALTERNATIVE_RAIL') {
    return { upi: true, card: false, netbanking: false, wallet: false };
  }
  return { upi: true, card: true, netbanking: true, wallet: true };
}

export async function ingestFailure(input: FailureIngest): Promise<IngestResult> {
  const claimed = await claimEvent(input.eventKey);
  if (!claimed) {
    const existing = await query<TransactionFailureRow>(
      `SELECT * FROM transaction_failures WHERE razorpay_pay_id = $1`,
      [input.payId]
    );
    return {
      status: 'already_processed',
      alreadyProcessed: true,
      transactionId: existing.rows[0]?.id,
      recoveryStatus: existing.rows[0]?.status,
      reason: `Duplicate event ${input.eventKey}`
    };
  }

  const txResult = await query<TransactionFailureRow>(
    `INSERT INTO transaction_failures (
       razorpay_pay_id, razorpay_order_id, customer_phone, customer_email,
       original_amount, failure_reason, failure_source, status, attempts_count,
       loss_mode, error_code, error_description, error_step
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', 0, $8, $9, $10, $11)
     ON CONFLICT (razorpay_pay_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      input.payId,
      input.orderId,
      input.customerPhone,
      input.customerEmail,
      input.originalAmount,
      input.failureReason,
      input.failureSource,
      input.lossMode,
      input.errorCode || null,
      input.errorDescription || null,
      input.errorStep || null
    ]
  );

  const tx = txResult.rows[0];
  if (tx.attempts_count > 0 || ['INTERVENING', 'RECOVERED', 'HOLDOUT', 'HALTED_EXHAUSTED', 'DEFERRED'].includes(tx.status)) {
    return {
      status: 'already_processed',
      alreadyProcessed: true,
      transactionId: tx.id,
      recoveryStatus: tx.status,
      reason: 'Failure already in a recovery workflow'
    };
  }

  const diagnosis = await DiagnosticClassifier.classify({
    errorCode: input.errorCode || input.failureReason,
    errorDescription: input.errorDescription,
    errorSource: input.failureSource,
    errorStep: input.errorStep
  });

  await query(
    `UPDATE transaction_failures
     SET diagnosed_strategy = $1,
         error_code = $2,
         error_description = $3,
         error_step = $4,
         rule_strategy = $5,
         groq_strategy = $6,
         diagnosis_disagreed = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8`,
    [
      diagnosis.strategy,
      input.errorCode || null,
      input.errorDescription || null,
      input.errorStep || null,
      diagnosis.ruleStrategy || diagnosis.strategy,
      diagnosis.groqStrategy || null,
      Boolean(diagnosis.disagreed),
      tx.id
    ]
  );

  await audit(
    tx.id,
    'AI_DIAGNOSIS',
    `${diagnosis.explanation} | loss_mode=${input.lossMode} strategy=${diagnosis.strategy} source=${diagnosis.source || 'rules'}`
  );

  if (diagnosis.disagreed) {
    await audit(
      tx.id,
      'DIAGNOSIS_DISAGREE',
      `rules=${diagnosis.ruleStrategy} groq=${diagnosis.groqStrategy} conservative=${diagnosis.strategy} (stricter action wins; discount cannot increase)`
    );
  }

  if (diagnosis.strategy === 'FRAUD_DECLINE_NO_RETRY') {
    await query(
      `UPDATE transaction_failures SET status='HALTED_EXHAUSTED', diagnosed_strategy=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [diagnosis.strategy, tx.id]
    );
    await audit(tx.id, 'FRAUD_DECLINE_HALTED', 'Fraud flag — silent halt. No WhatsApp, no payment link, no dashboard resend.');
    return {
      status: 'halted',
      transactionId: tx.id,
      recoveryStatus: 'HALTED_EXHAUSTED',
      reason: diagnosis.explanation,
      aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy }
    };
  }

  const cohort = assignCohort(input.payId, input.forceCohort);
  if (cohort === 'holdout') {
    await query(
      `UPDATE transaction_failures SET status='HOLDOUT', is_holdout=TRUE, diagnosed_strategy=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [diagnosis.strategy, tx.id]
    );
    await audit(tx.id, 'HOLDOUT_CONTROL', 'Assigned to 30% holdout. No intervention. Organic conversion is measured for lift.');
    return {
      status: 'holdout',
      transactionId: tx.id,
      recoveryStatus: 'HOLDOUT',
      cohort,
      reason: 'Control group — no nudge dispatched',
      aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy }
    };
  }

  return runIntervention(tx, diagnosis, { isRetry: false, forceQuietHours: input.forceQuietHours });
}

export async function runIntervention(
  tx: TransactionFailureRow,
  diagnosis: DiagnosticResult,
  opts: { isRetry: boolean; manual?: boolean; forceQuietHours?: boolean }
): Promise<IngestResult> {
  const originalAmount = Number(tx.original_amount);
  const attemptsCount = tx.attempts_count;
  const lossMode = (tx.loss_mode || 'PAYMENT_FAILED') as LossMode;

  if (diagnosis.strategy === 'FRAUD_DECLINE_NO_RETRY') {
    await query(
      `UPDATE transaction_failures SET status='HALTED_EXHAUSTED', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [tx.id]
    );
    await audit(tx.id, 'FRAUD_DECLINE_HALTED', 'Fraud flag — refusing contact.');
    return { status: 'halted', transactionId: tx.id, recoveryStatus: 'HALTED_EXHAUSTED', reason: diagnosis.explanation };
  }

  if (tx.status === 'HOLDOUT' || tx.is_holdout) {
    return { status: 'holdout', transactionId: tx.id, recoveryStatus: 'HOLDOUT', reason: 'Holdout cohort cannot be nudged' };
  }

  if (tx.status === 'RECOVERED') {
    return { status: 'ignored', transactionId: tx.id, recoveryStatus: 'RECOVERED', reason: 'Already recovered' };
  }

  const proposedDiscount =
    diagnosis.strategy === 'CUSTOMER_DROP_INCENTIVE_5_PERCENT' && lossMode === 'PAYMENT_FAILED'
      ? diagnosis.recommendedDiscountPercent
      : 0;

  const policy = PolicyEngine.evaluate({
    attemptsCount,
    originalAmount,
    proposedDiscountPercent: proposedDiscount,
    forceQuietHours: opts.forceQuietHours
  });

  if (!policy.allowed && policy.status === 'DEFERRED') {
    await query(
      `UPDATE transaction_failures
       SET status='DEFERRED', next_retry_at=$1, diagnosed_strategy=$2, updated_at=CURRENT_TIMESTAMP
       WHERE id=$3`,
      [policy.nextRetryAt, diagnosis.strategy, tx.id]
    );
    await audit(tx.id, opts.isRetry ? 'RETRY_DEFERRED_QUIET_HOURS' : 'DEFERRED_QUIET_HOURS', policy.reason);
    return {
      status: 'deferred',
      transactionId: tx.id,
      recoveryStatus: 'DEFERRED',
      reason: policy.reason,
      nextRetryAt: policy.nextRetryAt?.toISOString(),
      aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy }
    };
  }

  if (!policy.allowed) {
    await query(
      `UPDATE transaction_failures SET status=$1, diagnosed_strategy=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [policy.status, diagnosis.strategy, tx.id]
    );
    await audit(tx.id, 'POLICY_GUARDRAIL_HALT', policy.reason);
    return {
      status: 'halted',
      transactionId: tx.id,
      recoveryStatus: policy.status,
      reason: policy.reason,
      aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy }
    };
  }

  // First NSF contact is a wait, not a discount blast.
  if (diagnosis.strategy === 'INSUFFICIENT_FUNDS_DEFERRED' && !opts.isRetry) {
    const hours = nsfDeferHours(attemptsCount);
    const wakeAt = DateTime.now().plus({ hours }).toJSDate();
    await query(
      `UPDATE transaction_failures
       SET status='DEFERRED', next_retry_at=$1, diagnosed_strategy=$2, updated_at=CURRENT_TIMESTAMP
       WHERE id=$3`,
      [wakeAt, diagnosis.strategy, tx.id]
    );
    await audit(
      tx.id,
      'DEFERRED_INSUFFICIENT_FUNDS',
      `Insufficient funds — no discount, no immediate nudge. Retry scheduled at ${wakeAt.toISOString()}.`
    );
    return {
      status: 'deferred',
      transactionId: tx.id,
      recoveryStatus: 'DEFERRED',
      reason: 'Insufficient funds deferred (zero discount)',
      nextRetryAt: wakeAt.toISOString(),
      aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy }
    };
  }

    // Reserve this attempt atomically BEFORE any side effect (payment link,
  // WhatsApp). The check (attempts < MAX, status still nudgeable) and the
  // increment happen in one UPDATE, so if a dashboard resend and the scheduler
  // (or two server instances) race, exactly one wins the attempt and the rest
  // get no row back and send nothing. Previously the count was read, the
  // message sent, and only then incremented: every racer saw the old count.
  const claim = await query<{ attempts_count: number }>(
    `UPDATE transaction_failures
     SET attempts_count = attempts_count + 1,
         status = 'INTERVENING',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND attempts_count < $2
       AND status = ANY($3::text[])
     RETURNING attempts_count`,
    [tx.id, PolicyEngine.MAX_ATTEMPTS, nudgeableStatuses(opts)]
  );
  if (claim.rowCount === 0) {
    await audit(
      tx.id,
      'NUDGE_SKIPPED',
      'Attempt not reserved: the attempt cap was reached or the status changed (e.g. a concurrent nudge, payment, or promise-to-pay). Nothing sent.'
    );
    return {
      status: 'skipped',
      transactionId: tx.id,
      reason: 'Attempt cap reached or transaction state changed concurrently; nothing sent'
    };
  }
  const attemptNumber = claim.rows[0].attempts_count;

  const discountPercent = policy.approvedDiscountPercent;
  const discountAmount = policy.approvedDiscountAmount;
  const discountedAmount = Number((originalAmount - discountAmount).toFixed(2));
  const methods = checkoutMethods(diagnosis.strategy);
  const preferredMethod = diagnosis.strategy === 'BANK_OUTAGE_ALTERNATIVE_RAIL' ? 'upi' : 'any';

  const linkResult = await RazorpayLinkService.createDiscountedLink({
    orderId: tx.razorpay_order_id,
    originalAmount,
    discountedAmount,
    customerPhone: tx.customer_phone,
    customerEmail: tx.customer_email,
    recoveryTxId: tx.id,
    methods,
    description:
      lossMode === 'INVOICE_OVERDUE'
        ? `Overdue invoice ${tx.razorpay_order_id}`
        : lossMode === 'SUBSCRIPTION_FAILED'
          ? `Subscription retry ${tx.razorpay_order_id}`
                    : `Recovery attempt ${attemptNumber}/${PolicyEngine.MAX_ATTEMPTS} for ${tx.razorpay_order_id}`
  });

  const copyResult = await RecoveryAgent.generateCopy({
    customerPhone: tx.customer_phone,
    originalAmount,
    discountedAmount,
    discountPercent,
    failureCategory: diagnosis.category,
    failureReason: tx.error_description || tx.failure_reason,
    paymentLink: linkResult.shortUrl,
    orderId: tx.razorpay_order_id,
    strategy: diagnosis.strategy,
    lossMode,
    preferredMethod
  });

  const whatsappResult = await WhatsAppService.sendNudge({
    toPhone: tx.customer_phone,
    message: copyResult.message
  });

  const stepCost = copyResult.source === 'groq' ? 0.06 : NUDGE_COST;
  const stepName = opts.manual
    ? `MANUAL_NUDGE_ATTEMPT_${attemptNumber}`
    : opts.isRetry
      ? `RETRY_NUDGE_ATTEMPT_${attemptNumber}`
      : 'RECOVERY_NUDGE_DISPATCHED';
    
  await query(
    `UPDATE transaction_failures
        SET diagnosed_strategy=$1,
         total_discount_given=total_discount_given+$2,
         total_cost_incurred=total_cost_incurred+$3,
         payment_link_id=$4,
         preferred_method=$5,
         next_retry_at=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=$6`,
    [diagnosis.strategy, discountAmount, stepCost, linkResult.paymentLinkId, preferredMethod, tx.id]
  );

  await audit(tx.id, 'POLICY_EVALUATION', policy.reason);
  await audit(
    tx.id,
    stepName,
    `link=${linkResult.shortUrl} link_id=${linkResult.paymentLinkId} methods=${JSON.stringify(methods)} discount=₹${discountAmount} to=${whatsappResult.recipient} copy=${copyResult.source} mock_wa=${whatsappResult.isMock} mock_link=${linkResult.isMock}`,
    stepCost
  );

  return {
    status: 'intervention_dispatched',
    transactionId: tx.id,
    recoveryStatus: 'INTERVENING',
    attemptsCount: attemptNumber,
    aiDiagnosis: { category: diagnosis.category, strategy: diagnosis.strategy },
    approvedDiscount: discountAmount,
    paymentLink: linkResult.shortUrl,
    copySource: copyResult.source,
    whatsappStatus: whatsappResult.isMock ? 'mock_sent' : 'live_sent',
    cohort: 'treated'
  };
}

export async function retryDueTransaction(tx: TransactionFailureRow): Promise<IngestResult> {
  if (tx.status === 'PROMISE_TO_PAY') {
    const promisedFor = tx.promise_at ? new Date(tx.promise_at).toISOString() : 'n/a';
    await audit(
      tx.id,
      'PROMISE_DEADLINE_REACHED',
      `Customer's promised pay-by time (${promisedFor}) passed without payment. Resuming standard retry flow.`
    );
  }
  const diagnosis = await DiagnosticClassifier.classify({
    errorCode: tx.error_code || tx.failure_reason,
    errorDescription: tx.error_description || undefined,
    errorSource: tx.failure_source,
    errorStep: tx.error_step || undefined
  });
  return runIntervention(tx, diagnosis, { isRetry: true });
}

export async function manualNudge(transactionId: string): Promise<IngestResult> {
  const result = await query<TransactionFailureRow>(
    `SELECT * FROM transaction_failures WHERE id = $1`,
    [transactionId]
  );
  if (result.rowCount === 0) {
    return { status: 'error', reason: 'Transaction not found' };
  }
  const tx = result.rows[0];
    // Fail fast with a clear reason. The atomic claim in runIntervention is what
  // actually guarantees this even under races; this just avoids extra work.
  if (!nudgeableStatuses({ manual: true }).includes(tx.status)) {
    return {
      status: 'blocked',
      transactionId: tx.id,
      recoveryStatus: tx.status,
      reason: `Manual nudge not allowed while status is ${tx.status}`
    };
  }
  const diagnosis = await DiagnosticClassifier.classify({
    errorCode: tx.error_code || tx.failure_reason,
    errorDescription: tx.error_description || undefined,
    errorSource: tx.failure_source,
    errorStep: tx.error_step || undefined
  });
  return runIntervention(tx, diagnosis, { isRetry: true, manual: true });
}

export async function confirmRecovery(params: {
  amount: number;
  sourceEvent: string;
  paymentLinkId?: string | null;
  orderId?: string | null;
  payId?: string | null;
  recoveryTxId?: string | null;
}): Promise<{ status: string; transactionId?: string; recoveredAmount?: number; recoveryStatus?: string; reason?: string }> {
  const conditions: string[] = [];
  const values: any[] = [params.amount];
  let i = 2;

  if (params.recoveryTxId) {
    conditions.push(`id = $${i}`);
    values.push(params.recoveryTxId);
    i++;
  }
  if (params.paymentLinkId) {
    conditions.push(`payment_link_id = $${i}`);
    values.push(params.paymentLinkId);
    i++;
  }
  if (params.orderId) {
    conditions.push(`razorpay_order_id = $${i}`);
    values.push(params.orderId);
    i++;
  }
  if (params.payId) {
    conditions.push(`razorpay_pay_id = $${i}`);
    values.push(params.payId);
    i++;
  }

  if (conditions.length === 0) {
    return { status: 'ignored', reason: 'No identifiers to match a recovery record' };
  }

  const update = await query<TransactionFailureRow>(
    `UPDATE transaction_failures
     SET status = 'RECOVERED',
         recovered_amount = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('PENDING', 'INTERVENING', 'DEFERRED', 'HOLDOUT', 'PROMISE_TO_PAY')
       AND (${conditions.join(' OR ')})
     RETURNING *`,
    values
  );

  if (update.rowCount === 0) {
    return { status: 'acknowledged', reason: 'No matching open recovery record' };
  }

  const recovered = update.rows[0];
  await audit(
    recovered.id,
    'PAYMENT_RECOVERED',
    `Attributed via ${params.sourceEvent}. pay=${params.payId || 'n/a'} link=${params.paymentLinkId || 'n/a'} order=${params.orderId || 'n/a'} amount=₹${params.amount} holdout=${recovered.is_holdout}`
  );

  return {
    status: 'recovery_confirmed',
    transactionId: recovered.id,
    recoveredAmount: params.amount,
    recoveryStatus: 'RECOVERED'
  };
}

export interface PromiseReplyResult {
  status: 'promise_recorded' | 'unrecognized' | 'no_open_transaction';
  transactionId?: string;
  promiseAt?: string;
  reason?: string;
}

/**
 * Turns an inbound WhatsApp reply into a pause/wake state instead of a discard.
 * "kal kar dunga", "Friday", "2026-09-10" etc. (see recovery/promiseToPay.ts) pause
 * all further nudges until the promised date, then the retry scheduler wakes it.
 */
export async function recordPromiseReply(customerPhone: string, replyText: string): Promise<PromiseReplyResult> {
  const openTx = await query<TransactionFailureRow>(
    `SELECT * FROM transaction_failures
     WHERE customer_phone = $1 AND status IN ('INTERVENING', 'DEFERRED')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [customerPhone]
  );

  if (openTx.rowCount === 0) {
    return { status: 'no_open_transaction', reason: `No open recovery found for ${customerPhone}` };
  }

  const tx = openTx.rows[0];
  const wakeAt = parsePromiseReply(replyText);

  if (!wakeAt) {
    await audit(
      tx.id,
      'INBOUND_REPLY_UNRECOGNIZED',
      `Customer replied "${replyText}" — no promise date recognised. No status change.`
    );
    return { status: 'unrecognized', transactionId: tx.id, reason: 'Could not parse a promise date from the reply' };
  }

  await query(
    `UPDATE transaction_failures
     SET status = 'PROMISE_TO_PAY',
         promise_at = $1,
         defer_reason = 'customer_promise',
         next_retry_at = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [wakeAt, tx.id]
  );

  const wakeAtIST = DateTime.fromJSDate(wakeAt).setZone('Asia/Kolkata').toFormat("hh:mm a, dd LLL yyyy");
  await audit(
    tx.id,
    'PROMISE_TO_PAY_RECORDED',
    `Customer replied "${replyText}" on WhatsApp. Parsed promise-to-pay date: ${wakeAtIST} IST. Paused — no further nudges until then.`
  );

  return { status: 'promise_recorded', transactionId: tx.id, promiseAt: wakeAt.toISOString() };
}

export async function loadSummary(): Promise<RecoverySummary> {
  const result = await query<any>(`
    SELECT
      COUNT(*)::int                                               AS total_failures,
      COUNT(*) FILTER (WHERE status = 'PENDING')::int            AS pending,
      COUNT(*) FILTER (WHERE status = 'INTERVENING')::int        AS intervening,
      COUNT(*) FILTER (WHERE status = 'RECOVERED')::int          AS recovered,
      COUNT(*) FILTER (WHERE status = 'HALTED_POLICY')::int      AS halted_policy,
      COUNT(*) FILTER (WHERE status = 'HALTED_EXHAUSTED')::int   AS halted_exhausted,
      COUNT(*) FILTER (WHERE status = 'DEFERRED')::int           AS deferred,
      COUNT(*) FILTER (WHERE status = 'HOLDOUT' OR is_holdout)::int AS holdout,
      COUNT(*) FILTER (WHERE status = 'PROMISE_TO_PAY')::int      AS promise_to_pay,
      COUNT(*) FILTER (WHERE diagnosis_disagreed)::int            AS diagnosis_disagreements,
      COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE))::int AS treated_count,
      COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS treated_recovered,
      COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE))::int AS holdout_count,
      COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS holdout_recovered,
      COALESCE(SUM(original_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_at_risk,
      COALESCE(SUM(recovered_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_recovered_amount,
      COALESCE(SUM(original_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_at_risk,
      COALESCE(SUM(recovered_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_recovered_amount,
      COALESCE(SUM(original_amount), 0)::numeric(12,2)           AS total_original_at_risk,
      COALESCE(SUM(recovered_amount), 0)::numeric(12,2)          AS total_recovered_amount,
      COALESCE(SUM(total_discount_given), 0)::numeric(12,2)      AS total_discount_given,
      COALESCE(SUM(total_cost_incurred), 0)::numeric(12,2)       AS total_cost_incurred
    FROM transaction_failures
  `);

  const row = result.rows[0];
  const totalFailures = Number(row.total_failures);
  const recovered = Number(row.recovered);
  const treatedCount = Number(row.treated_count);
  const treatedRecovered = Number(row.treated_recovered);
  const holdoutCount = Number(row.holdout_count);
  const holdoutRecovered = Number(row.holdout_recovered);
  const treatedAtRisk = Number(row.treated_at_risk);
  const treatedRecoveredAmount = Number(row.treated_recovered_amount);
  const holdoutAtRisk = Number(row.holdout_at_risk);
  const holdoutRecoveredAmount = Number(row.holdout_recovered_amount);
  const totalRecoveredAmount = Number(row.total_recovered_amount);
  const totalDiscountGiven = Number(row.total_discount_given);
  const totalCostIncurred = Number(row.total_cost_incurred);

  const recoveryRatePercent = totalFailures > 0
    ? Number(((recovered / totalFailures) * 100).toFixed(1))
    : 0;
  const treatedRate = treatedCount > 0 ? Number(((treatedRecovered / treatedCount) * 100).toFixed(1)) : 0;
  const holdoutRate = holdoutCount > 0 ? Number(((holdoutRecovered / holdoutCount) * 100).toFixed(1)) : 0;
  const lift = Number((treatedRate - holdoutRate).toFixed(1));

  const holdoutRateFraction = holdoutCount > 0 ? holdoutRecoveredAmount / Math.max(holdoutAtRisk, 0.01) : 0;
  const expectedIfHoldout = treatedAtRisk * holdoutRateFraction;
  const incrementalRevenue = Number((treatedRecoveredAmount - expectedIfHoldout).toFixed(2));

  // recovered_amount is already the rupees captured (net of any discount).
  const netRevenueSaved = Number((totalRecoveredAmount - totalCostIncurred).toFixed(2));

  const strategyResult = await query<any>(`
    SELECT
      COALESCE(diagnosed_strategy, 'UNCLASSIFIED') AS strategy,
      COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE))::int AS treated_count,
      COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS treated_recovered,
      COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE))::int AS holdout_count,
      COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS holdout_recovered,
      COALESCE(SUM(original_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_at_risk,
      COALESCE(SUM(recovered_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_recovered_amount,
      COALESCE(SUM(original_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_at_risk,
      COALESCE(SUM(recovered_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_recovered_amount
    FROM transaction_failures
    WHERE diagnosed_strategy IS NOT NULL
    GROUP BY diagnosed_strategy
    ORDER BY treated_count DESC, holdout_count DESC
  `);

  const strategyLift: StrategyLiftRow[] = strategyResult.rows.map((r: any) => {
    const sTreatedCount = Number(r.treated_count);
    const sTreatedRecovered = Number(r.treated_recovered);
    const sHoldoutCount = Number(r.holdout_count);
    const sHoldoutRecovered = Number(r.holdout_recovered);
    const sTreatedAtRisk = Number(r.treated_at_risk);
    const sTreatedRecoveredAmount = Number(r.treated_recovered_amount);
    const sHoldoutAtRisk = Number(r.holdout_at_risk);
    const sHoldoutRecoveredAmount = Number(r.holdout_recovered_amount);

    const sTreatedRate = sTreatedCount > 0 ? Number(((sTreatedRecovered / sTreatedCount) * 100).toFixed(1)) : 0;
    const sHoldoutRate = sHoldoutCount > 0 ? Number(((sHoldoutRecovered / sHoldoutCount) * 100).toFixed(1)) : 0;
    const sHoldoutRateFraction = sHoldoutCount > 0 ? sHoldoutRecoveredAmount / Math.max(sHoldoutAtRisk, 0.01) : 0;
    const sIncrementalRevenue = Number((sTreatedRecoveredAmount - sTreatedAtRisk * sHoldoutRateFraction).toFixed(2));

    return {
      strategy: r.strategy,
      treated_count: sTreatedCount,
      treated_recovered: sTreatedRecovered,
      treated_rate_percent: sTreatedRate,
      holdout_count: sHoldoutCount,
      holdout_recovered: sHoldoutRecovered,
      holdout_rate_percent: sHoldoutRate,
      lift_percentage_points: Number((sTreatedRate - sHoldoutRate).toFixed(1)),
      incremental_revenue: sIncrementalRevenue
    };
  });

  return {
    total_failures: totalFailures,
    pending: Number(row.pending),
    intervening: Number(row.intervening),
    recovered,
    halted_policy: Number(row.halted_policy),
    halted_exhausted: Number(row.halted_exhausted),
    deferred: Number(row.deferred),
    holdout: Number(row.holdout),
    total_original_at_risk: Number(row.total_original_at_risk),
    total_recovered_amount: totalRecoveredAmount,
    total_discount_given: totalDiscountGiven,
    total_cost_incurred: totalCostIncurred,
    recovery_rate_percent: recoveryRatePercent,
    treated_count: treatedCount,
    treated_recovered: treatedRecovered,
    treated_recovery_rate_percent: treatedRate,
    holdout_count: holdoutCount,
    holdout_recovered: holdoutRecovered,
    holdout_recovery_rate_percent: holdoutRate,
    lift_percentage_points: lift,
    incremental_revenue: incrementalRevenue,
    net_revenue_saved: netRevenueSaved,
    promise_to_pay: Number(row.promise_to_pay),
    diagnosis_disagreements: Number(row.diagnosis_disagreements),
    strategy_lift: strategyLift
  };
}
