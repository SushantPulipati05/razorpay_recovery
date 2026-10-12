import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db';
import { manualNudge } from '../src/recovery/pipeline';
import { WhatsAppService } from '../src/integrations/whatsapp';
import { migrateTestDb, resetTables, insertFailure, getFailure, countNudgesSent } from './helpers';

// In production, sending a WhatsApp is a network call to Twilio that takes
// ~100-500 ms. The mock in tests returns instantly, which hides the race window.
// Add realistic latency back so concurrent nudges overlap the way they do live.
const realSend = WhatsAppService.sendNudge.bind(WhatsAppService);
WhatsAppService.sendNudge = async (params) => {
  await new Promise((r) => setTimeout(r, 100));
  return realSend(params);
};

before(() => migrateTestDb());
beforeEach(() => resetTables());
after(() => pool.end());

// Bug (b): runIntervention read attempts_count, sent the WhatsApp, and only then
// incremented. Concurrent nudges all saw the old count and all sent.
test('concurrent nudges never exceed the 3-attempt cap', async () => {
  const tx = await insertFailure({ status: 'INTERVENING', attempts: 2 }); // one attempt left

  // Five "Resend" clicks (or a click racing the scheduler) at the same moment.
  const results = await Promise.all(Array.from({ length: 5 }, () => manualNudge(tx.id)));

  const dispatched = results.filter((r) => r.status === 'intervention_dispatched').length;
  const row = await getFailure(tx.id);

  assert.equal(dispatched, 1, `expected exactly 1 nudge to be dispatched, got ${dispatched}`);
  assert.equal(await countNudgesSent(tx.id), 1, 'audit trail should show exactly 1 nudge sent');
  assert.equal(row.attempts_count, 3, `attempts_count must stop at 3, got ${row.attempts_count}`);
});

test('a manual nudge does not message a customer who promised to pay', async () => {
  const tx = await insertFailure({ status: 'PROMISE_TO_PAY', attempts: 1 });

  const result = await manualNudge(tx.id);

  assert.notEqual(result.status, 'intervention_dispatched');
  assert.equal(await countNudgesSent(tx.id), 0);
  assert.equal((await getFailure(tx.id)).attempts_count, 1);
});

test('a manual nudge does not message a halted transaction', async () => {
  const tx = await insertFailure({ status: 'HALTED_POLICY', attempts: 1 });

  const result = await manualNudge(tx.id);

  assert.notEqual(result.status, 'intervention_dispatched');
  assert.equal(await countNudgesSent(tx.id), 0);
});

test('a single nudge still works normally', async () => {
  const tx = await insertFailure({ status: 'INTERVENING', attempts: 0 });

  const result = await manualNudge(tx.id);

  assert.equal(result.status, 'intervention_dispatched');
  assert.equal(await countNudgesSent(tx.id), 1);
  assert.equal((await getFailure(tx.id)).attempts_count, 1);
});