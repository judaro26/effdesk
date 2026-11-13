// src/context.js: builds the pool, the mailer and the auth once per function instance.
import { getPool } from './db.js';
import { makeMailer } from './email.js';
import { makeAuth } from './auth.js';
import { blobStore } from './storage.js';
import { sinks } from './log.js';
import { recordError } from './errors.js';
import { recordRequest } from './performance.js';
let ctx = null;
export function context() {
  if (!ctx) { const pool = getPool(), mailer = makeMailer(); ctx = { pool, mailer, store: blobStore() };
    // sign-in is built the first time something asks for it: the public help center, chat and health checks never do, so their cold start skips it
    let auth = null; Object.defineProperty(ctx, 'auth', { enumerable: true, get() { return auth || (auth = makeAuth({ pool, mailer })); } });
    sinks.onError = e => recordError(pool, mailer, process.env, e);   // failures are counted and the owners are emailed (src/errors.js)
    sinks.onRequest = sample => recordRequest(pool, { ...sample, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } }, process.env);
  }
  return ctx;
}
