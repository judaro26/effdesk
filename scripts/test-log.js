// scripts/test-log.js: LOGGING: one line per request, nothing private in it, sent to Axiom (and any other drain) without ever slowing or breaking a request.
import { check, done } from './lib/check.js';
import { logged, log, annotate, scrub, ship, sinks, captureConsole } from '../src/log.js';
const sent = []; let fail = false, ENV = {}; const realLog = console.log, realWarn = console.warn, realErr = console.error; let printed = [];
console.log = (...a) => { printed.push(a.join(' ')); }; console.warn = (...a) => { printed.push(a.join(' ')); }; console.error = (...a) => { printed.push(a.join(' ')); };
sinks.fetch = async (url, init) => { if (fail) throw new Error('down'); sent.push({ url, init, lines: JSON.parse(init.body) }); return { ok: true }; };
sinks.env = () => ENV; captureConsole();
const req = (path = '/api/tickets?token=SECRET123&q=a@b.co', method = 'POST') => new Request('https://app.effdesk.com' + path, { method, headers: { referer: 'https://shop.test/page', 'x-country': 'US' } });
// scrubbing
const sc = scrub({ password: 'pw', token: 't', email: 'a@b.co', body: 'hello there', subject: 'Hi', ok: true, nested: { cookie: 'c', n: 3 }, messages: 4, error: new Error('boom') });
check('passwords, tokens, emails, subjects and text never go into a line', sc.password === '[removed]' && sc.token === '[removed]' && sc.email === '[removed]' && sc.body === '[removed]' && sc.subject === '[removed]' && sc.nested.cookie === '[removed]');
check('counts, flags and errors stay', sc.ok === true && sc.nested.n === 3 && sc.messages === 4 && sc.error.message === 'boom' && /Error: boom/.test(sc.error.stack));
// with no drain configured the line only goes to the function log
ENV = {}; let res = await logged('tickets', async () => { annotate({ org: 'o1', user: 'u1', action: 'list', email: 'x@y.co' }); return new Response('{}', { status: 200 }); })(req());
const line = JSON.parse(printed.find(l => /"event":"request"/.test(l)));
check('every call writes one request line with method, path, status, time, workspace, person and action', line.event === 'request' && line.fn === 'tickets' && line.method === 'POST' && line.path === '/api/tickets' && line.status === 200 && typeof line.ms === 'number' && line.org === 'o1' && line.user === 'u1' && line.action === 'list' && line.level === 'info');
check('the query string (it can hold tokens) and annotated emails are not logged', !/SECRET123/.test(JSON.stringify(line)) && !/a@b\.co|x@y\.co/.test(JSON.stringify(line)) && line.email === '[removed]');
check('the answer carries a request id that matches the line', res.headers.get('x-request-id') === line.request_id && sent.length === 0);
// Axiom
ENV = { AXIOM_TOKEN: 'xaat-1', AXIOM_DATASET: 'effdesk', DEPLOY_ID: 'abc123def456789' };
res = await logged('tickets', async () => new Response('x', { status: 403 }))(req());
const ax = sent[0];
check('with Axiom set, the lines are posted to the dataset with the token', ax && ax.url === 'https://api.axiom.co/v1/datasets/effdesk/ingest' && ax.init.headers.Authorization === 'Bearer xaat-1' && Array.isArray(ax.lines) && ax.lines[0]._time && ax.lines[0].deploy === 'abc123def456');
check('a refused call is logged as a warning, a server error as an error', ax.lines[0].level === 'warn' && ax.lines[0].status === 403);
ENV = { AXIOM_TOKEN: 'x', AXIOM_DATASET: 'd', AXIOM_DOMAIN: 'https://api.eu.axiom.co/' }; await logged('a', async () => new Response('x'))(req('/a')); check('the EU address can be used', /^https:\/\/api\.eu\.axiom\.co\/v1\/datasets\/d\/ingest$/.test(sent[sent.length - 1].url));
ENV = { LOG_DRAIN_URL: 'https://in.logs.example.com', LOG_DRAIN_TOKEN: 'tok' }; await logged('a', async () => new Response('x'))(req('/b')); const dr = sent[sent.length - 1];
check('any other service can be a drain', dr.url === 'https://in.logs.example.com' && dr.init.headers.Authorization === 'Bearer tok');
// errors
ENV = { AXIOM_TOKEN: 'x', AXIOM_DATASET: 'd' }; sent.length = 0; printed = [];
res = await logged('tickets', async () => { throw new Error('database is down for user a@b.co'); })(req('/api/tickets'));
const body = await res.json();
check('an exception becomes a clean 500 with a request id, and the page never sees the error text', res.status === 500 && /Something went wrong/.test(body.error) && body.requestId === res.headers.get('x-request-id') && !/database/.test(JSON.stringify(body)));
check('the exception is logged with its stack, plus the request line as an error', sent[0].lines.some(l => l.event === 'exception' && /Error/.test(l.error.stack)) && sent[0].lines.some(l => l.event === 'request' && l.level === 'error' && l.status === 500));
// console.warn from existing code, and extra events
sent.length = 0; await logged('x', async () => { console.warn('csat error: boom'); log('info', 'email', { ok: true, to_domain: 'example.com' }); return new Response('ok'); })(req('/c'));
check('console warnings and extra events join the same request', sent[0].lines.some(l => l.event === 'console' && /csat error/.test(l.message_text)) && sent[0].lines.some(l => l.event === 'email' && l.to_domain === 'example.com') && new Set(sent[0].lines.map(l => l.request_id)).size === 1);
// a broken drain never breaks the request
fail = true; res = await logged('x', async () => new Response('fine', { status: 200 }))(req('/d')); check('a log service that is down changes nothing for the visitor', res.status === 200 && await res.text() === 'fine'); fail = false;
let waited = null; await logged('x', async () => new Response('ok'))(req('/e'), { waitUntil: p => { waited = p; } }); check('on Netlify the sending happens after the answer (waitUntil)', waited && typeof waited.then === 'function'); await waited;
res = await logged('cron', async () => undefined)(req('/cron', 'GET')); check('a scheduled function that returns nothing is fine', res.status === 200);
// outside a request
sent.length = 0; log('info', 'startup', { n: 1 }); await new Promise(r => setTimeout(r, 20)); check('a line outside any request is still sent', sent.length === 1 && sent[0].lines[0].event === 'startup');
console.log = realLog; console.warn = realWarn; console.error = realErr;
done(); process.exit(0);
