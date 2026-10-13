# razorpay-recover

[![CI](https://github.com/SushantPulipati05/razorpay_recovery/actions/workflows/ci.yml/badge.svg)](https://github.com/SushantPulipati05/razorpay_recovery/actions/workflows/ci.yml)

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
npm run test:units    # policy, classifier, copy, holdout (no DB, no server)
npm run test:db       # integration tests against a real Postgres (see below)
npm run test          # end-to-end against a running service on localhost:4000
```

`test:db` needs an **empty, throwaway** database. It truncates tables between tests:

```bash
# PowerShell:  $env:TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/razor_recover_test"
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/razor_recover_test
npm run test:db
```

CI (GitHub Actions) runs the type check, unit tests and `test:db` against a Postgres 16 service container on every push.

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

---

## Reliability fixes (and the tests that prove them)

Each bug below was first reproduced with a failing test against real Postgres, then fixed.

**1. Concurrent nudges could exceed the 3-attempt cap.**
The attempt check was read-then-write: five simultaneous `/api/nudge` calls could all read `attempts_count = 2`, all pass the policy check, and all send a WhatsApp message.
*Fix:* a single atomic claim, `UPDATE ... SET attempts_count = attempts_count + 1 WHERE attempts_count < 3 AND status = ANY(...) RETURNING`. Only one caller gets a row back, and the rest are skipped.
*Test:* `test/attempt-cap.test.ts` fires 5 concurrent nudges with 100 ms of injected send latency → exactly 1 dispatch.

**2. A crash mid-processing could lose a webhook forever.**
The event id was marked processed *before* the work was done. If processing failed, Razorpay's retry was dropped as a duplicate, so the payment was never recorded.
*Fix:* record-then-process. Claiming the event and storing the row happen in one transaction (`withTransaction`). Processing runs after that, and the scheduler picks up rows stuck in `PENDING`. A `payment.captured` confirmation is claimed and applied in the same transaction, so it either fully happens or can be retried.
*Test:* `test/event-idempotency.test.ts` breaks a table mid-request with a trigger, then checks that the retry or the scheduler recovers it, and that duplicates are processed once.

**3. Unsafe production defaults.**
Customer-messaging endpoints had no auth, and the service would start in production with the dev webhook secret.
*Fix:* `x-admin-key` auth (constant-time compare) on `/api/nudge`, `/api/jobs/retry-now` and `/api/failures`. In production, the service refuses to start unless `DATABASE_URL`, a real webhook secret and an `ADMIN_API_KEY` (16+ chars) are set. `/health` now returns 503 when Postgres is down.
*Test:* `test/security.test.ts`.

## Known limitations

- **External side effects aren't transactional.** The payment link and WhatsApp message are sent before the final DB update, so a crash in between can send a message the DB doesn't record. A full fix is a transactional outbox.
- **Money uses JS numbers.** Amounts are `NUMERIC` in Postgres but go through floating-point arithmetic in Node. Production code should use integer paise.
- **Scheduler throughput is capped.** Each run handles at most 20 rows with a 6 s throttle, about 480 retries per day at the hourly default. That's fine for a demo, but not for production volume.
- **No versioned migrations.** The schema is created by `scripts/init-db.js`, and `schema/schema.sql` is out of date.
- **500 responses include `err.message`**, which can leak internal details.
