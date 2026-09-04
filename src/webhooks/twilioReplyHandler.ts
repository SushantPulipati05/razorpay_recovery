import { Request, Response } from 'express';
import { recordPromiseReply } from '../recovery/pipeline';

/**
 * Inbound WhatsApp replies (Twilio "A Message Comes In" webhook, form-encoded).
 * A recognised promise ("kal kar dunga", "Friday", "2026-09-10", ...) pauses the
 * recovery — no more nudges — until the promised time, when the retry scheduler
 * wakes it back up. An unrecognised reply is logged and otherwise ignored; we
 * never invent a promise date from noise.
 *
 * Point Twilio's WhatsApp sandbox/number at POST /webhooks/twilio-reply.
 * scripts/test-promise-to-pay.ts simulates this without needing that console
 * step configured for a demo.
 */
export async function twilioReplyHandler(req: Request, res: Response): Promise<void> {
  const fromRaw = String(req.body?.From || '');
  const body = String(req.body?.Body || '').trim();
  const phone = fromRaw.replace(/^whatsapp:/i, '').trim();

  if (!phone || !body) {
    res.status(200).type('text/xml').send('<Response></Response>');
    return;
  }

  try {
    const result = await recordPromiseReply(phone, body);
    console.log(`[TwilioReply] ${phone} -> "${body}" => ${result.status}`);
  } catch (err: any) {
    console.error('[TwilioReply] Error recording reply:', err.message);
  }

  // Empty TwiML response — we reply on WhatsApp via the outbound nudge flow, not inline.
  res.status(200).type('text/xml').send('<Response></Response>');
}
