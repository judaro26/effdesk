// src/context.js: builds the pool, the mailer and the auth once per function instance.
import { getPool } from './db.js';
import { makeMailer } from './email.js';
import { makeAuth } from './auth.js';
import { blobStore } from './storage.js';
import { sinks } from './log.js';
import { recordError } from './errors.js';
let ctx = null;
export function context() {
  if (!ctx) { const pool = getPool(), mailer = makeMailer(); ctx = { pool, mailer, auth: makeAuth({ pool, mailer }), store: blobStore() };
    sinks.onError = e => recordError(pool, mailer, process.env, e);   // failures are counted and the owners are emailed (src/errors.js)
  }
  return ctx;
}
