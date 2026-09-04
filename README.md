# razorpay-recover

Autonomous revenue recovery for **Razorpay Hackathon Track 03**. Detects money at risk, picks a bounded intervention, executes it, and reports **lift vs a holdout** — not just a recovery rate.

## What it does

| Loss mode | Trigger | Intervention |
|---|---|---|
| Payment failure | `payment.failed` | Strategy-specific (below) |
| Failed subscription | `subscription.charged` with failed payment | Retry link, no cart-discount language |
| Overdue invoice | `POST /api/ingest/receivable` | B2B chase, 0% discount |

| Strategy | Action |
|---|---|
| Bank / issuer down | UPI-only payment link, **0% discount**, refund reassurance |
| Checkout drop / OTP | Immediate WhatsApp + **5% cap** goodwill link |
| Insufficient funds | **Defer** (no discount, no “items reserved”), then retry |
| Fraud | **Silent halt** — no WhatsApp, no dashboard resend |

Guardrails: 3-attempt hard stop, TRAI 9pm–9am IST **defers until 9am** (does not discard), 5% discount ceiling, webhook HMAC + event idempotency. Force it live for a demo with `notes.force_quiet_hours: true` — otherwise it only fires for real between 9pm and 9am IST.

Every diagnosis runs the deterministic rules first; Groq is only ever consulted on top, and a disagreement always resolves to the stricter action (discount can't increase). Both `rule_strategy` and `groq_strategy` are stored per transaction and surfaced on the dashboard (`Groq overruled` badge) so a skeptical judge can see the rules are load-bearing, not decoration.

An unanswered WhatsApp nudge doesn't just retry blind — a reply like *"kal kar dunga"*, *"Friday"*, or an ISO date is parsed into a **promise-to-pay** pause/wake state: no further nudges until the promised time, then the scheduler wakes it automatically. An unrecognised reply is logged and left alone rather than guessing a date.

Attribution: recovery links store `recovery_tx_id`. `payment_link.paid` (and `payment.captured`) close the loop even when Razorpay mints a new order id.

Measurement: 30% holdout by default (`HOLDOUT_PERCENT`). `/api/summary` returns treated vs holdout rates, lift in percentage points, and incremental rupees. Captured amount is already net of discount; ops cost is subtracted once.

---

## Run it

PostgreSQL must be running. Copy `.env` if needed (`DATABASE_URL`, optional Razorpay / Groq / Twilio keys). Placeholder Razorpay keys still work — links and WhatsApp fall back to mocks.

### 1. Install and create tables

```bash
cd F:\Users\susha\documents\razorpay
npm install
npm run init-db
```

### 2. Start the recovery service

```bash
npm run dev
```

Service: `http://localhost:4000`  
Health: `http://localhost:4000/health`  
ROI: `http://localhost:4000/api/summary`

### 3. (Optional) Dashboard

```bash
cd dashboard
npm install
```

Create `dashboard/.env.local`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/razor_recover
RECOVERY_SERVICE_URL=http://localhost:4000
```

```bash
npm run dev
```

Dashboard defaults to port **3001** (`npm run dev` in `dashboard/`).

### 4. Batch demo judges can watch

With the service running:

```bash
cd F:\Users\susha\documents\razorpay
npm run test:batch
```

This ingests 20 payment failures (bank / drop / NSF / fraud, including holdout), a failed subscription, an overdue invoice, and one payment with TRAI quiet hours forced on; releases deferred NSF/quiet-hour rows; attributes four recoveries via `payment_link.paid`; attributes one organic holdout capture; then prints lift **broken out by strategy**, not just overall.

Then refresh the dashboard and open one row’s audit trail.

### 4b. Promise-to-pay (Hinglish pause/wake) demo

```bash
npm run test:promise
```

Simulates an inbound WhatsApp reply ("Bhai abhi busy hu, kal kar dunga payment") against one of the batch demo’s open transactions and prints the parsed wake time and audit entry. This posts straight to `/webhooks/twilio-reply` — the same route a real Twilio WhatsApp number’s "a message comes in" webhook would hit — so it’s provable without configuring a public URL for the demo.

### 5. Tests

```bash
npm run test:units    # policy, classifier, copy, holdout (no server)
npm run test          # end-to-end against localhost:4000
```

Live Razorpay test mode: put real `rzp_test_...` keys in `.env`, point the Razorpay webhook at `/webhooks/razorpay`, pay a generated link, and watch status become `RECOVERED`.

---

## Useful endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/webhooks/razorpay` | POST | HMAC-verified ingest + attribution |
| `/webhooks/twilio-reply` | POST | Inbound WhatsApp reply → promise-to-pay parse |
| `/api/summary` | GET | Batch metrics, holdout lift, net recovered |
| `/api/failures` | GET | Rows + audit trail |
| `/api/nudge` | POST | `{ "transactionId" }` — policy-checked resend |
| `/api/ingest/receivable` | POST | Overdue invoice (`x-ingest-secret` = webhook secret) |
| `/api/jobs/retry-now` | POST | `{ "releaseDeferred": true }` then run scheduler |
| `/health` | GET | Process + Postgres |

Force a cohort on a test payment with `notes.recovery_cohort`: `"treated"` or `"holdout"`. Force the TRAI quiet-hours guardrail on with `notes.force_quiet_hours: true`.
