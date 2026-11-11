// src/log.js: LOGGING. Every function call writes one structured "request" line (what was asked, the answer, how long it took), plus lines for errors, warnings, emails, AI calls and audit entries.
//   Lines always go to the Netlify function log as JSON. When AXIOM_TOKEN and AXIOM_DATASET are set they are also sent to Axiom (free plan: 500 GB a month); LOG_DRAIN_URL (+ LOG_DRAIN_TOKEN) sends the same JSON array to any other service (Better Stack, Datadog, Grafana Loki gateway ...).
//   Privacy: lines never carry message text, email addresses, passwords, tokens, cookies or request bodies. Who and where are ids (user id, workspace id), and the path has no query string.
//   Sending is done after the answer has gone out (context.waitUntil on Netlify) and can never make a request fail or slow down.
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const store = new AsyncLocalStorage();
const SECRET_KEY = /pass|token|secret|authorization|cookie|body|text|email|subject|message|credential|key$|signature/i;
const SAFE_KEYS = new Set(['messages', 'message_id', 'email_kind', 'email_ok']);          // names that look sensitive but are counts, ids or flags
export function scrub(v, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
  if (v instanceof Error) return { name: v.name, message: String(v.message).slice(0, 300), stack: String(v.stack || '').split('\n').slice(0, 6).join('\n') };
  if (depth > 3) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 20).map(x => scrub(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v).slice(0, 40)) o[k] = SECRET_KEY.test(k) && !SAFE_KEYS.has(k) ? '[removed]' : scrub(x, depth + 1); return o; }
  return String(v).slice(0, 100);
}
const base = (env = process.env) => ({ service: 'effdesk', deploy: String(env.DEPLOY_ID || env.COMMIT_REF || '').slice(0, 12) || undefined, ctx: env.CONTEXT || undefined });
export const sinks = { fetch: (...a) => fetch(...a), env: () => process.env, now: () => Date.now(), onError: null };   // onError(entry) records a failure in the error tracker (set by context.js)

// one line: goes to the request's buffer (sent when the request ends) or, outside a request, straight out
export function log(level, event, fields = {}) {
  const env = sinks.env(), line = { _time: new Date(sinks.now()).toISOString(), level, event, ...base(env), ...scrub(fields) }, s = store.getStore();
  if (s) { line.request_id = s.id; line.fn = s.fn; s.lines.push(line); if (s.lines.length > 200) s.lines.shift(); if (level === 'error' && event !== 'request') s.errs.push(line); }
  try { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line)); } catch { }
  if (!s) void ship([line], env);
  return line;
}
export const info = (event, f) => log('info', event, f), warn = (event, f) => log('warn', event, f), error = (event, f) => log('error', event, f);
// attach who and what to the current request's line (ids only)
export const annotate = fields => { const s = store.getStore(); if (s) Object.assign(s.meta, scrub(fields)); };

// send lines to every configured destination; returns what each answered (the admin console's "test logging" shows it). Never throws.
export async function shipReport(lines, env = sinks.env()) {
  const jobs = [];
  const run = (sink, p) => { const t0 = sinks.now(); return Promise.resolve(p).then(r => ({ sink, ok: !!r && r.ok !== false, status: r && r.status, ms: sinks.now() - t0 }), e => ({ sink, ok: false, error: String(e && e.message || e).slice(0, 200), ms: sinks.now() - t0 })); };
  if (env.AXIOM_TOKEN && env.AXIOM_DATASET) {
    const host = String(env.AXIOM_DOMAIN || 'api.axiom.co').replace(/^https?:\/\//, '').replace(/\/$/, '');
    jobs.push(run('axiom', sinks.fetch(`https://${host}/v1/datasets/${encodeURIComponent(env.AXIOM_DATASET)}/ingest`, { method: 'POST', headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(lines) })));
  }
  if (env.LOG_DRAIN_URL) jobs.push(run('drain', sinks.fetch(env.LOG_DRAIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.LOG_DRAIN_TOKEN ? { Authorization: `Bearer ${env.LOG_DRAIN_TOKEN}` } : {}) }, body: JSON.stringify(lines) })));
  if (!jobs.length) return [];
  const timeout = new Promise(r => setTimeout(() => r({ sink: 'timeout', ok: false, error: 'No answer within 3 seconds.' }), 3000));
  return Promise.race([Promise.all(jobs), timeout.then(t => [t])]);
}
export async function ship(lines, env = sinks.env()) { if (lines.length) await shipReport(lines, env); }

// the failures of one request, handed to the error tracker (one entry per distinct line, at most 3; a 5xx answer with no logged exception is an entry of its own)
async function reportErrors(s, req, url, res) {
  const hook = sinks.onError; if (typeof hook !== 'function') return;
  const env = sinks.env(), deploy = String(env.DEPLOY_ID || env.COMMIT_REF || '').slice(0, 12), seen = new Set(), entries = [];
  for (const l of s.errs) { const e = l.error || {}, message = e.message || l.message_text || l.event, k = (e.name || '') + message; if (seen.has(k)) continue; seen.add(k); entries.push({ fn: s.fn, name: e.name || (l.event === 'console' ? 'ConsoleError' : 'Error'), message, stack: e.stack || '', path: url.pathname, status: res && res.status, request_id: s.id, deploy, org: s.meta.org }); if (entries.length >= 3) break; }
  if (!entries.length && res && res.status >= 500) entries.push({ fn: s.fn, name: 'HTTP ' + res.status, message: `${req.method} ${url.pathname} answered ${res.status}`, stack: '', path: url.pathname, status: res.status, request_id: s.id, deploy, org: s.meta.org });
  for (const e of entries) { try { await hook(e); } catch { } }
}
// wrap a function handler: one request line, errors become a clean 500 with a request id, shipping happens after the answer
export function logged(name, handler) {
  return async (req, nctx) => {
    const id = crypto.randomUUID().slice(0, 12), t0 = sinks.now(), s = { id, fn: name, lines: [], errs: [], meta: {} }, url = (() => { try { return new URL(req.url); } catch { return { pathname: '' }; } })();
    let res;
    await store.run(s, async () => {
      try { res = await handler(req, nctx); }
      catch (e) { log('error', 'exception', { error: e }); res = new Response(JSON.stringify({ error: 'Something went wrong on our side. Try again in a moment.', requestId: id }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
      res = res || new Response(null, { status: 200 });
      const status = res.status;
      log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', { method: req.method, path: url.pathname, status, ms: sinks.now() - t0, ...s.meta, ref: (() => { try { return new URL(req.headers.get('referer') || '').host || undefined; } catch { return undefined; } })(), country: req.headers.get('x-country') || undefined });
    });
    try { res.headers.set('x-request-id', id); } catch { /* an immutable response keeps its headers */ }
    const send = Promise.all([ship(s.lines, sinks.env()), reportErrors(s, req, url, res)]);
    if (nctx && typeof nctx.waitUntil === 'function') nctx.waitUntil(send); else await send;
    return res;
  };
}
// warnings and errors printed with console.warn / console.error also become log lines (the existing code uses them)
let patched = false;
export function captureConsole() {
  if (patched) return; patched = true;
  for (const lvl of ['warn', 'error']) { const orig = console[lvl].bind(console); console[lvl] = (...a) => { orig(...a); const s = store.getStore(); if (s && !(typeof a[0] === 'string' && a[0].startsWith('{"_time"'))) { const line = { _time: new Date(sinks.now()).toISOString(), level: lvl, event: 'console', message_text: a.map(x => typeof x === 'string' ? x : x instanceof Error ? x.message : JSON.stringify(scrub(x))).join(' ').slice(0, 300), ...base(sinks.env()), request_id: s.id, fn: s.fn }; if (lvl === 'error') s.errs.push(line); s.lines.push(line); } }; }
}
