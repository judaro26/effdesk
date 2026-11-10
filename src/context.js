// src/context.js: builds the pool, the mailer and the auth once per function instance.
import { getPool } from './db.js';
import { makeMailer } from './email.js';
import { makeAuth } from './auth.js';
import { blobStore } from './storage.js';
let ctx = null;
export function context() {
  if (!ctx) { const pool = getPool(), mailer = makeMailer(); ctx = { pool, mailer, auth: makeAuth({ pool, mailer }), store: blobStore() }; }
  return ctx;
}
