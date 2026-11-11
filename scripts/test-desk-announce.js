// scripts/test-desk-announce.js: THE OWNER'S ANNOUNCEMENT BANNER and A SUSPENDED WORKSPACE in the desk.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function open(me, search = '') {
  const fetchFn = async (url, opts) => { const ok = body => ({ ok: true, status: 200, json: async () => body }); if (url === '/api/me') return ok(me); return ok({ ok: true }); };
  const dom = new JSDOM(pub('desk.html'), { runScripts: 'outside-only', url: 'https://app.test/desk.html' + search }), w = dom.window; w.__EFFDESK_TEST__ = true; w.eval(pub('js/format.js')); w.eval(pub('js/desk.js'));
  await w.EffDeskDesk.start(w.document, fetchFn, { path: '/desk.html', search, host: 'app.test', go() { } }); await tick(); return w;
}
const user = { id: 'u1', email: 'ann@acme.test' };
let w = await open({ user, organizations: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'admin', suspended: 'Payment dispute' }], banner: { text: 'Maintenance <b>tonight</b>', tone: 'warn', link: 'https://effdesk.com/status' } });
check('a suspended workspace shows why and how to get it back, not the desk', /This workspace is suspended/.test(w.document.querySelector('[data-suspended]').textContent) && /Payment dispute/.test(w.document.querySelector('[data-suspended]').textContent));
const bar = w.document.querySelector('[data-announcement]');
check('the announcement shows above everything, as text, with its tone and link', bar && bar.classList.contains('warn') && bar.textContent.indexOf('Maintenance <b>tonight</b>') === 0 && !bar.querySelector('b') && bar.querySelector('a').getAttribute('href') === 'https://effdesk.com/status' && w.document.body.firstElementChild === bar);
w = await open({ user, organizations: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'admin', suspended: true }], banner: null });
check('with no announcement there is no banner, and a suspension without a reason still explains itself', !w.document.querySelector('[data-announcement]') && /Access has been paused/.test(w.document.querySelector('[data-suspended]').textContent));
done();
