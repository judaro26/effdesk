// scripts/test-admin.js: THE PLATFORM ADMIN PAGE against a fake API: licence grant and removal, and importing in batches with a check first.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const calls = []; let failAt = 0;
const fetchFn = async (url, opts) => {
  const b = opts && opts.body ? JSON.parse(opts.body) : null; calls.push([opts.method, url, b]);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (url === '/api/me') return ok({ user: {}, organizations: [] });
  if (url === '/api/license') return b.slug === 'nobody' ? { ok: false, status: 404, json: async () => ({ error: 'No such organization.' }) } : ok({ ok: true });
  if (url === '/api/import') { if (failAt && calls.filter(c => c[1] === '/api/import').length === failAt) return { ok: false, status: 500, json: async () => ({ error: 'Boom.' }) }; return ok({ ok: true, dryRun: b.dryRun, tickets: { added: b.data.tickets.length, existing: 0, skipped: 0 }, messages: b.data.tickets.length * 2, articles: { added: b.data.articles.length, existing: 0, skipped: 0 }, filesNotCopied: 1, warnings: ['w'] }); }
};
const dom = new JSDOM(pub('admin.html'), { runScripts: 'outside-only', url: 'https://app.test/admin.html' }), w = dom.window; w.__EFFDESK_TEST__ = true; w.eval(pub('js/admin.js'));
await w.EffDeskAdmin.start(w.document, fetchFn); await tick();
const $ = s => w.document.querySelector(s), setFile = obj => { const f = $('[data-file]'); Object.defineProperty(f, 'files', { value: [new w.File([JSON.stringify(obj)], 'export.json', { type: 'application/json' })], configurable: true }); };
const fill = (label, v) => { $(`input[aria-label="${label}"]`).value = v; };
fill('Organization slug', 'mdv'); fill('Note', 'our company'); $('[data-grant]').click(); await tick();
check('Grant posts the slug and note to the licence endpoint and confirms', calls.some(c => c[0] === 'POST' && c[1] === '/api/license' && c[2].slug === 'mdv' && c[2].note === 'our company') && /Licence granted to mdv/.test($('.msg').textContent));
$('[data-revoke]').click(); await tick();
check('Remove uses DELETE', calls.some(c => c[0] === 'DELETE' && c[1] === '/api/license' && c[2].slug === 'mdv') && /Licence removed/.test($('.msg').textContent));
fill('Organization slug', 'nobody'); $('[data-grant]').click(); await tick();
check('a server error is shown as it is', /No such organization/.test($('.msg').textContent));
$('[data-check]').click(); await tick();
check('importing needs an organization and a file first', /Choose the organization and the export file/.test($('.msg').textContent));
const data = { tickets: Array.from({ length: 250 }, (_, i) => ({ id: 't' + i })), articles: Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i })) };
fill('Import into', 'mdv'); setFile(data); calls.length = 0; $('[data-check]').click(); await tick(200);
const imps = calls.filter(c => c[1] === '/api/import');
check('the file is sent in batches of 100, as a check (dry run) first', imps.length === 3 && imps.every(c => c[2].dryRun === true && c[2].orgSlug === 'mdv') && imps.map(c => c[2].data.tickets.length).join() === '100,100,50' && imps[0][2].data.articles.length === 30 && imps[1][2].data.articles.length === 0);
check('the summary says nothing was written and adds up the batches', /nothing was written/.test($('.msg').textContent) && /250 tickets would be added/.test($('.msg').textContent) && /30 articles would be added/.test($('.msg').textContent) && /3 files not copied/.test($('.msg').textContent));
calls.length = 0; $('[data-import]').click(); await tick(200);
check('Import sends the same batches for real', calls.filter(c => c[1] === '/api/import').every(c => c[2].dryRun === false) && /Import finished\. 250 tickets added/.test($('.msg').textContent));
failAt = 2; calls.length = 0; $('[data-import]').click(); await tick(200); failAt = 0;
check('if a batch fails the import stops and says so', calls.filter(c => c[1] === '/api/import').length === 2 && /Boom/.test($('.msg').textContent));
Object.defineProperty($('[data-file]'), 'files', { value: [new w.File(['not json'], 'x.json')], configurable: true }); $('[data-import]').click(); await tick(100);
check('a file that is not JSON is explained', /not valid JSON/.test($('.msg').textContent));
done();
