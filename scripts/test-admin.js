// scripts/test-admin.js: THE PLATFORM ADMIN PAGE against a fake API: licence grant and removal, and importing in batches with a check first.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const calls = []; let failAt = 0;
const fetchFn = async (url, opts) => {
  const b = opts && opts.body ? JSON.parse(opts.body) : null; calls.push([opts.method, url, b]);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (url === '/api/me') return ok({ user: {}, organizations: [] });
  if (url === '/api/admin/do' && b && b.action === 'performance') return ok({ ok: true, range: '24h', sampleRate: 0.1, summary: { requests: 120, avg_ms: 180, p95_bucket: '100–499 ms', error_rate: 0.8, slow_requests: 2, pool_waiting_max: 0 }, diagnostics: [{ severity: 'success', title: 'No threshold breaches detected', detail: 'The sample is within thresholds.' }], routes: [{ function_name: 'tickets', path: '/api/tickets', requests: 120, avg_ms: 180, p95_bucket: '100–499 ms', max_ms: 900 }], tenants: [{ org_id: 'org9', requests: 100, avg_ms: 170, errors: 0, max_ms: 900 }], series: [{ hour: '2026-11-13T12:00:00Z', requests: 120, avg_ms: 180, errors: 1 }], sqlSampleRate: 0.03, sqlQueries: [{ query_hash: 'abcdef0123456789', operation: 'SELECT', function_name: 'tickets', samples: 8, avg_ms: 80, p95_bucket: '100–499 ms', max_ms: 300, errors: 0 }], vitals: [{ metric: 'LCP', page: '/agent/:id/tickets', device: 'mobile', samples: 6, avg_value: 2300, good_count: 4, needs_improvement_count: 2, poor_count: 0 }], notes: ['Approximate p95 band.'] });
  if (url === '/api/admin/customers') return ok({ ok: true, totals: { organizations: 3, paying: 1, agents: 7, tickets30: 120, pastDue: 1, stalled: 1, heavy: 0 }, customers: [
    { slug: 'rooster', name: 'Rooster', owner: 'r@rooster.co', plan: 'team', status: 'active', seatsPaid: 5, agents: 4, invites: 1, lastActive: new Date().toISOString(), tickets: { total: 300, last30: 100 }, health: 'healthy' },
    { slug: 'stale', name: 'Stale Co', owner: 's@stale.co', plan: 'free', status: 'none', seatsPaid: 0, agents: 1, invites: 0, lastActive: null, tickets: { total: 0, last30: 0 }, health: 'stalled' },
    { slug: 'late', name: 'Late Ltd', owner: 'l@late.co', plan: 'team', status: 'past_due', seatsPaid: 2, agents: 2, invites: 0, lastActive: null, tickets: { total: 20, last30: 20 }, health: 'past_due' }] });
  if (url === '/api/license') return b.slug === 'nobody' ? { ok: false, status: 404, json: async () => ({ error: 'No such organization.' }) } : ok({ ok: true });
  if (url.indexOf('/api/admin/customer?slug=') === 0) { const on = url.endsWith('rooster'); return ok({ ok: true, customer: { id: 'org9', name: 'Rooster', slug: 'rooster' }, billing: { plan: 'team', status: 'active', interval: 'year', seatsPaid: 5, seatsUsed: 4, seatLimit: 5, renews: null }, people: [{ name: 'Rita', email: 'r@rooster.co', role: 'owner', lastActive: null }], usage: [{ day: '2026-11-01', tickets: 3, replies: 5, agents: 4, active_agents: 2, api_calls: 0 }, { day: '2026-11-02', tickets: 6, replies: 2, agents: 4, active_agents: 3, api_calls: 9 }], totals: { tickets: 9, replies: 7, apiCalls: 9 }, flags: [{ kind: 'seats', text: '4 of 5 seats in use.' }], access: on ? { active: true, grantedBy: 'r@rooster.co', expiresAt: new Date(Date.now() + 3600000).toISOString() } : { active: false }, entries: [{ at: new Date().toISOString(), action: 'support.entered', who: 'root@effdesk.test' }] }); }
  if (url === '/api/import') { if (failAt && calls.filter(c => c[1] === '/api/import').length === failAt) return { ok: false, status: 500, json: async () => ({ error: 'Boom.' }) }; return ok({ ok: true, dryRun: b.dryRun, tickets: { added: b.data.tickets.length, existing: 0, skipped: 0 }, messages: b.data.tickets.length * 2, articles: { added: b.data.articles.length, existing: 0, skipped: 0 }, filesNotCopied: 1, warnings: ['w'] }); }
};
const dom = new JSDOM(pub('admin.html'), { runScripts: 'outside-only', url: 'https://app.test/admin.html' }), w = dom.window; w.__EFFDESK_TEST__ = true; w.eval(pub('js/admin-panels.js')); w.eval(pub('js/admin.js'));
await w.EffDeskAdmin.start(w.document, fetchFn); await tick();
const $ = s => w.document.querySelector(s), setFile = obj => { const f = $('[data-file]'); Object.defineProperty(f, 'files', { value: [new w.File([JSON.stringify(obj)], 'export.json', { type: 'application/json' })], configurable: true }); };
const fill = (label, v) => { $(`input[aria-label="${label}"]`).value = v; };
check('the customer list shows totals and one row per organization', /3Organizations/.test($('[data-totals]').textContent) && w.document.querySelectorAll('[data-org]').length === 3 && /team \(active\) · 5 seats/.test($('[data-org=rooster]').textContent) && /4 \(\+1 invited\)/.test($('[data-org=rooster]').textContent));
{ const f = $('select[aria-label="Show"]'); f.value = 'stalled'; f.dispatchEvent(new w.Event('change')); check('the list can show only stalled customers', w.document.querySelectorAll('[data-org]').length === 1 && !!$('[data-org=stale]'));
  f.value = 'all'; f.dispatchEvent(new w.Event('change')); const sb = $('input[aria-label="Search customers"]'); sb.value = 'late.co'; sb.dispatchEvent(new w.Event('input')); check('and be searched by name, address or owner', w.document.querySelectorAll('[data-org]').length === 1 && !!$('[data-org=late]')); sb.value = ''; sb.dispatchEvent(new w.Event('input')); }
check('the list can be downloaded as a spreadsheet', $('[data-customers-csv]').getAttribute('href') === '/api/admin/customers?format=csv');
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
check('the page has a side menu in groups with a section for each task', [...w.document.querySelectorAll('.admnav [data-nav]')].map(a => a.getAttribute('data-nav')).join() === 'overview,performance,customers,errors,status,licence,users,settings,logging,activity,import' && w.document.querySelectorAll('.navhead').length === 4);
check('only the chosen section shows, and the menu marks it', !$('[data-panel=overview]').hidden && $('[data-panel=customers]').hidden && $('[data-nav=overview]').getAttribute('aria-current') === 'page');
$('[data-nav=performance]').click(); await tick(); check('the Performance & health page loads sampled metrics and diagnostics', !$('[data-panel=performance]').hidden && $('[data-performance] .perf-tiles') && /Slowest endpoints/.test($('[data-performance]').textContent) && $('[data-performance]').textContent.includes('Slowest SQL fingerprints') && $('[data-performance]').textContent.includes('Core Web Vitals') && $('[data-performance]').textContent.includes('abcdef0123456789') && /\/api\/tickets/.test($('[data-performance]').textContent));
$('[data-nav=customers]').click(); check('choosing a menu item switches the section', $('[data-panel=overview]').hidden && !$('[data-panel=customers]').hidden && $('[data-nav=customers]').getAttribute('aria-current') === 'page' && !$('[data-nav=overview]').hasAttribute('aria-current'));
$('[data-subtab=attention]').click(); check('the sub tabs filter the customers (needs attention = past due or stalled)', w.document.querySelectorAll('[data-org]').length === 2 && $('[data-subtab=attention]').getAttribute('aria-selected') === 'true');
$('[data-subtab=all]').click(); check('the overview lists customers that need attention', w.document.querySelectorAll('[data-attention] li').length === 2);
$('[data-open-customer=rooster]').click(); await tick();
check('opening a customer shows billing, usage charts, who has access and any flags', !!$('[data-detail=rooster]') && /4 of 5 seats/.test($('[data-flags]').textContent) && /4 of 5Seats used/.test($('[data-detail]').textContent) && w.document.querySelectorAll('.chart .bar1').length === 6 && /r@rooster\.co/.test($('[data-people]').textContent));
check('there is always a link to the read-only support view', $('[data-open-support]').getAttribute('href') === '/desk.html?org=org9&support=1' && !$('[data-no-access]'));
$('[data-detail-back]').click(); check('a back button returns to the list', !$('[data-detail]') && !!$('[data-open-customer=rooster]'));
{ const d2 = new JSDOM(pub('admin.html'), { runScripts: 'outside-only', url: 'https://app.test/admin.html' }), w2 = d2.window; w2.__EFFDESK_TEST__ = true; w2.eval(pub('js/admin-panels.js')); w2.eval(pub('js/admin.js'));
  const f403 = async url => url === '/api/me' ? { ok: true, status: 200, json: async () => ({ user: { email: 'support@mdv-ai.com' }, organizations: [] }) } : { ok: false, status: 403, json: async () => ({ error: 'Only the platform owner can do that.' }) };
  await w2.EffDeskAdmin.start(w2.document, f403); await tick();
  const er = w2.document.querySelector('[data-customers-error]'); check('when the customer list is refused the page says why and names the account, not an empty list', er && /support@mdv-ai\.com/.test(er.textContent) && /PLATFORM_ADMIN_EMAILS/.test(er.textContent) && !w2.document.querySelector('[data-totals]')); }
done();
