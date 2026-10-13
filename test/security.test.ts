import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { adminAuth } from '../src/security/adminAuth';

/** Runs the admin middleware against a fake request; returns the HTTP status (200 = allowed through). */
function callAdmin(opts: { key: string; production: boolean }, header?: string): number {
  let status = 200;
  const req: any = { headers: header === undefined ? {} : { 'x-admin-key': header } };
  const res: any = {
    status(code: number) { status = code; return res; },
    json() { return res; }
  };
  adminAuth(opts)(req, res, () => {});
  return status;
}

const KEY = 'a-long-admin-key-for-tests';

test('admin endpoints reject a missing or wrong key', () => {
  assert.equal(callAdmin({ key: KEY, production: true }), 401);
  assert.equal(callAdmin({ key: KEY, production: true }, 'wrong-key'), 401);
});

test('admin endpoints accept the right key', () => {
  assert.equal(callAdmin({ key: KEY, production: true }, KEY), 200);
});

test('without a configured key, production refuses but local development allows', () => {
  assert.equal(callAdmin({ key: '', production: true }), 503);
  assert.equal(callAdmin({ key: '', production: false }), 200);
});

/** Starts a child process that only loads config/env.ts with the given variables. */
function loadEnvWith(vars: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.join('test', 'fixtures', 'load-env.ts')], {
    // Empty strings (not missing keys) so dotenv can't fill them in from a local .env file.
    env: { ...process.env, ...vars },
    encoding: 'utf8'
  });
}

test('production refuses to start with the default webhook secret or no admin key', () => {
  const r = loadEnvWith({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/x',
    RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_12345',
    ADMIN_API_KEY: ''
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}. stdout: ${r.stdout}`);
  assert.match(r.stderr, /RAZORPAY_WEBHOOK_SECRET/);
  assert.match(r.stderr, /ADMIN_API_KEY/);
});

test('production starts when real secrets are provided', () => {
  const r = loadEnvWith({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/x',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_real_value_from_razorpay',
    ADMIN_API_KEY: KEY
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /ENV_LOADED/);
});