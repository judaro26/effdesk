// scripts/test-paddle-webhook.js: verifies bounded reads for the public Paddle webhook.
import { check, done } from './lib/check.js';
import { paddleWebhook } from '../src/handlers.js';

let databaseTouched = false;
const pool = { query: async () => { databaseTouched = true; throw new Error('Database must not be reached by these tests.'); } };
const env = { PADDLE_WEBHOOK_SECRET: 'test-webhook-secret' };

const oversized = await paddleWebhook(new Request('https://app.effdesk.test/.netlify/functions/paddle', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ padding: 'x'.repeat(200001) }),
}), { pool, env });
check('oversized Paddle webhook bodies without Content-Length are rejected', oversized.status === 413 && !databaseTouched);

const invalidSignature = await paddleWebhook(new Request('https://app.effdesk.test/.netlify/functions/paddle', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=1;h1=invalid' },
  body: JSON.stringify({ event_id: 'evt_test', event_type: 'subscription.updated' }),
}), { pool, env, now: 1000 });
check('bounded Paddle webhook bodies still require a valid signature', invalidSignature.status === 401 && !databaseTouched);

await done();
