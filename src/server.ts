import express, { Request, Response } from 'express';
import { env } from './config/env';
import { pool, query } from './config/db';
import { razorpayWebhookHandler, WebhookRequest } from './webhooks/razorpayHandler';
import { twilioReplyHandler } from './webhooks/twilioReplyHandler';
import { runRetryCheck, startRetryScheduler } from './jobs/retryScheduler';
import { ingestFailure, loadSummary, manualNudge } from './recovery/pipeline';

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-razorpay-signature, x-ingest-secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as WebhookRequest).rawBody = buf;
    }
  })
);

app.use(express.urlencoded({ extended: true }));

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const dbTest = await query('SELECT NOW() as current_time');
    res.status(200).json({
      status: 'healthy',
      service: 'razorpay-recover',
      timestamp: new Date().toISOString(),
      database: 'connected',
      dbTime: dbTest.rows[0].current_time
    });
  } catch (err: any) {
    res.status(200).json({
      status: 'degraded',
      service: 'razorpay-recover',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: err.message
    });
  }
});

app.post('/webhooks/razorpay', (req: Request, res: Response) => {
  razorpayWebhookHandler(req as WebhookRequest, res);
});

app.post('/webhooks/twilio-reply', (req: Request, res: Response) => {
  twilioReplyHandler(req, res);
});

app.get('/api/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await loadSummary();
    res.status(200).json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/failures', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT tf.*,
              json_agg(json_build_object(
                'id', al.id,
                'step', al.step,
                'reasoning', al.reasoning,
                'cost_incurred', al.cost_incurred,
                'timestamp', al.timestamp
              ) ORDER BY al.timestamp ASC) FILTER (WHERE al.id IS NOT NULL) AS audits
       FROM transaction_failures tf
       LEFT JOIN audit_logs al ON tf.id = al.transaction_id
       GROUP BY tf.id
       ORDER BY tf.created_at DESC
       LIMIT 80;`
    );
    res.status(200).json({ count: result.rowCount, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nudge', async (req: Request, res: Response) => {
  try {
    const transactionId = req.body?.transactionId;
    if (!transactionId) {
      res.status(400).json({ success: false, error: 'Missing transactionId' });
      return;
    }
    const result = await manualNudge(transactionId);
    const ok = result.status === 'intervention_dispatched' || result.status === 'deferred';
    res.status(ok ? 200 : 400).json({
      success: ok,
      message: result.reason || result.status,
      ...result
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ingest/receivable', async (req: Request, res: Response) => {
  const secret = req.headers['x-ingest-secret'] as string | undefined;
  if (!secret || secret !== env.RAZORPAY_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Invalid ingest secret' });
    return;
  }
  try {
    const invoiceId = String(req.body?.invoiceId || '').trim();
    const amount = Number(req.body?.amount);
    const customerPhone = String(req.body?.customerPhone || '+919876543210');
    if (!invoiceId || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'invoiceId and amount are required' });
      return;
    }
    const result = await ingestFailure({
      eventKey: `invoice.overdue:${invoiceId}`,
      payId: `inv_${invoiceId}`,
      orderId: invoiceId,
      customerPhone,
      customerEmail: req.body?.customerEmail || null,
      originalAmount: amount,
      failureReason: 'invoice_overdue',
      failureSource: 'receivables',
      errorCode: 'INVOICE_OVERDUE',
      errorDescription: `${req.body?.daysOverdue || 15} days past due`,
      errorStep: 'collection',
      lossMode: 'INVOICE_OVERDUE',
      forceCohort: req.body?.cohort === 'holdout' || req.body?.cohort === 'treated' ? req.body.cohort : 'treated'
    });
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs/retry-now', async (req: Request, res: Response) => {
  try {
    if (req.body?.releaseDeferred) {
      await query(
        `UPDATE transaction_failures SET next_retry_at = NOW() WHERE status = 'DEFERRED'`
      );
    }
    await runRetryCheck();
    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(env.PORT, () => {
  console.log('====================================================');
  console.log(`razorpay-recover service running on port ${env.PORT}`);
  console.log(`Webhook URL:     http://localhost:${env.PORT}/webhooks/razorpay`);
  console.log(`WhatsApp reply:  http://localhost:${env.PORT}/webhooks/twilio-reply`);
  console.log(`Health Check:    http://localhost:${env.PORT}/health`);
  console.log(`Summary (ROI):   http://localhost:${env.PORT}/api/summary`);
  console.log(`Failures:        http://localhost:${env.PORT}/api/failures`);
  console.log('====================================================');
});

let retryTimer: NodeJS.Timeout;
server.on('listening', () => {
  retryTimer = startRetryScheduler();
});

const shutdown = async () => {
  console.log('\nGracefully shutting down...');
  clearInterval(retryTimer);
  server.close(async () => {
    await pool.end().catch(() => {});
    console.log('Server closed and DB connections released.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
