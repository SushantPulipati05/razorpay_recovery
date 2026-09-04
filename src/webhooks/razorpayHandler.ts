import { Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { claimEvent, confirmRecovery, ingestFailure } from '../recovery/pipeline';
import { RecoveryCohort } from '../recovery/cohort';

export interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!rawBody || !signature) {
    return false;
  }
  try {
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

function forceCohortFromNotes(notes: any): RecoveryCohort | undefined {
  const raw = notes?.recovery_cohort || notes?.cohort;
  if (raw === 'holdout' || raw === 'treated') return raw;
  return undefined;
}

/**
 * Demo/ops hook: force the TRAI quiet-hours guardrail to evaluate as if it were
 * 10:30 PM IST, so the defer-until-9am path can be shown live instead of only
 * firing when the wall clock happens to be inside 9pm-9am IST.
 */
function forceQuietHoursFromNotes(notes: any): boolean | undefined {
  const raw = notes?.force_quiet_hours;
  if (raw === true || raw === 'true') return true;
  return undefined;
}

export async function razorpayWebhookHandler(req: WebhookRequest, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;

  const isValid = verifyWebhookSignature(req.rawBody, signature);
  if (!isValid) {
    console.warn('[Webhook] Invalid x-razorpay-signature received.');
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  const payload = req.body;
  const event = payload?.event;
  console.log(`[Webhook] Received Razorpay event: ${event}`);

  try {
    if (event === 'payment.failed') {
      const payment = payload?.payload?.payment?.entity;
      if (!payment?.id) {
        res.status(400).json({ error: 'Malformed webhook payload: missing payment.entity' });
        return;
      }
      const result = await ingestFailure({
        eventKey: `payment.failed:${payment.id}`,
        payId: payment.id,
        orderId: payment.order_id || `order_rec_${String(payment.id).slice(-8)}`,
        customerPhone: payment.contact || '+919999999999',
        customerEmail: payment.email || null,
        originalAmount: payment.amount ? payment.amount / 100 : 0,
        failureReason: payment.error_reason || payment.error_code || 'BAD_REQUEST_ERROR',
        failureSource: payment.error_source || 'customer',
        errorCode: payment.error_code,
        errorDescription: payment.error_description,
        errorStep: payment.error_step,
        lossMode: 'PAYMENT_FAILED',
        forceCohort: forceCohortFromNotes(payment.notes),
        forceQuietHours: forceQuietHoursFromNotes(payment.notes)
      });
      res.status(200).json(result);
      return;
    }

    if (event === 'subscription.charged') {
      const payment = payload?.payload?.payment?.entity;
      const subscription = payload?.payload?.subscription?.entity;
      if (!payment?.id) {
        res.status(400).json({ error: 'Malformed subscription.charged payload' });
        return;
      }
      if (payment.status && payment.status !== 'failed') {
        res.status(200).json({ status: 'ignored', reason: 'subscription.charged payment is not failed' });
        return;
      }
      const result = await ingestFailure({
        eventKey: `subscription.charged.failed:${payment.id}`,
        payId: payment.id,
        orderId: subscription?.id || payment.order_id || `sub_${String(payment.id).slice(-8)}`,
        customerPhone: payment.contact || '+919999999999',
        customerEmail: payment.email || null,
        originalAmount: payment.amount ? payment.amount / 100 : 0,
        failureReason: payment.error_reason || payment.error_code || 'subscription_charge_failed',
        failureSource: payment.error_source || 'issuer',
        errorCode: payment.error_code,
        errorDescription: payment.error_description || 'Subscription charge failed',
        errorStep: payment.error_step,
        lossMode: 'SUBSCRIPTION_FAILED',
        forceCohort: forceCohortFromNotes(payment.notes || subscription?.notes),
        forceQuietHours: forceQuietHoursFromNotes(payment.notes || subscription?.notes)
      });
      res.status(200).json(result);
      return;
    }

    if (event === 'payment_link.paid') {
      const link = payload?.payload?.payment_link?.entity;
      const payment = payload?.payload?.payment?.entity;
      const eventKey = `payment_link.paid:${link?.id || payment?.id || Date.now()}`;
      const claimed = await claimEvent(eventKey);
      if (!claimed) {
        res.status(200).json({ status: 'already_processed', reason: eventKey });
        return;
      }
      const amount = payment?.amount ? payment.amount / 100 : link?.amount ? link.amount / 100 : 0;
      const result = await confirmRecovery({
        amount,
        sourceEvent: event,
        paymentLinkId: link?.id,
        orderId: link?.notes?.original_order_id || payment?.order_id,
        payId: payment?.id,
        recoveryTxId: link?.notes?.recovery_tx_id
      });
      res.status(200).json(result);
      return;
    }

    if (event === 'payment.captured' || event === 'payment.authorized') {
      const payment = payload?.payload?.payment?.entity;
      if (!payment?.id) {
        res.status(400).json({ error: 'Malformed webhook payload: missing payment.entity' });
        return;
      }
      const eventKey = `${event}:${payment.id}`;
      const claimed = await claimEvent(eventKey);
      if (!claimed) {
        res.status(200).json({ status: 'already_processed' });
        return;
      }
      const notes = payment.notes || {};
      const result = await confirmRecovery({
        amount: payment.amount ? payment.amount / 100 : 0,
        sourceEvent: event,
        paymentLinkId: notes.payment_link_id || payment.payment_link_id,
        orderId: notes.original_order_id || payment.order_id,
        payId: payment.id,
        recoveryTxId: notes.recovery_tx_id
      });
      res.status(200).json(result);
      return;
    }

    res.status(200).json({ status: 'ignored', message: `Event ${event} is not handled.` });
  } catch (err: any) {
    console.error('[WebhookHandler] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
