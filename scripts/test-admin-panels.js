// scripts/test-admin-panels.js: THE OWNER'S TOOLS IN THE ADMIN CONSOLE against a fake API: errors, status page, logging, settings, people, activity, one customer's limits.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const did = []; let errs = [{ id: '1', source: 'server', fn: 'tickets', name: 'TypeError', message: 'x is undefined', stack: 'at a (b.js:1:1)', path: '/api/tickets', status: 500, request_id: 'req-9', count: 4, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), resolved_at: null }];
const fetchFn = async (url, opts) => {
  const b = opts && opts.body ? JSON.parse(opts.body) : {}; const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (url === '/api/me') return ok({ user: {}, organizations: [] });
  if (url === '/api/admin/customers') return ok({ ok: true, totals: { organizations: 1, paying: 0, agents: 1, tickets30: 0, pastDue: 0, stalled: 0, heavy: 0 }, customers: [] });
  if (url === '/api/admin/do') {
    did.push(b);
    switch (b.action) {
      case 'system': return ok({ ok: true, status: 'degraded', openErrors: 1, openIncidents: 1, logging: { axiom: { configured: false } } });
      case 'errors': return ok({ ok: true, errors: b.state === 'resolved' ? [] : errs, summary: { open: errs.length, occurrences24: 4 } });
      case 'status-list': return ok({ ok: true, components: [{ id: 1, name: 'Help desk', description: '', position: 1, status: 'operational', auto_check: 'database', visible: true }, { id: 2, name: 'Email', description: '', position: 2, status: 'operational', auto_check: null, visible: true }], incidents: [{ id: 7, kind: 'incident', title: 'Slow', status: 'investigating', impact: 'minor', component_ids: [2], started_at: new Date().toISOString(), resolved_at: null }] });
      case 'logging': return ok({ ok: true, logging: { axiom: { configured: true, dataset: 'effdesk', domain: 'api.axiom.co' }, drain: { configured: false } } });
      case 'logging-test': return ok({ ok: true, configured: true, results: [{ sink: 'axiom', ok: false, status: 401 }] });
      case 'settings-get': return ok({ ok: true, settings: { announcement: { active: false, text: '', tone: 'info', link: '' }, signups: { open: true, message: '' } } });
      case 'user-search': return ok({ ok: true, users: [{ id: 'u1', name: 'Olivia', email: 'o@acme.test', verified: false, created_at: new Date().toISOString(), last_active: null, sessions: 2, orgs: [{ name: 'Acme', slug: 'acme', role: 'owner' }] }] });
      case 'audit-list': return ok({ ok: true, entries: [{ id: 1, at: new Date().toISOString(), actor: 'boss@effdesk.test', action: 'customer.suspend', target: 'acme' }] });
      case 'customer-get': return ok({ ok: true, org: { slug: 'acme' }, overrides: { seat_limit: 7, mail_per_day: null, storage_mb: null, ai_monthly: null, features_on: [], features_off: ['whatsapp'], suspended: false, suspended_reason: '', note: 'hi' }, effective: { plan: 'pro', license: false, seats: 7, features: ['sso'] }, allFeatures: ['sso', 'whatsapp'] });
      default: return ok({ ok: true, alerted: true, signedOut: 2 });
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
const dom = new JSDOM(pub('admin.html'), { runScripts: 'outside-only', url: 'https://app.test/admin.html#errors' }), w = dom.window; w.__EFFDESK_TEST__ = true; w.eval(pub('js/admin-panels.js')); w.eval(pub('js/admin.js'));
await w.EffDeskAdmin.start(w.document, fetchFn); await tick(60);
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
check('the overview has a health strip: status page, open errors, logging', (w.location.hash = '#overview', true));
w.document.querySelector('[data-nav=overview]').click(); await tick();
check('the strip says what the status page shows, how many errors are open and whether logging is connected', /Degraded performance/.test($('[data-health]').textContent) && /1 open errors/.test($('[data-health]').textContent) && /Axiom not set up/.test($('[data-health]').textContent));
$('[data-nav=errors]').click(); await tick();
check('errors are listed with a count, where they happened and a summary', $$('[data-error]').length === 1 && /x is undefined/.test($('[data-error]').textContent) && /×4/.test($('[data-error]').textContent) && /1 open/.test($('[data-error-summary]').textContent));
check('the stack stays hidden until the row is opened', $('.edetail').hasAttribute('hidden')); $('.etitle').click(); await tick(); check('opening it shows the stack and the request id to search for', !$('.edetail').hasAttribute('hidden') && /req-9/.test($('.edetail').textContent) && /b\.js/.test($('.edetail pre').textContent));
did.length = 0; $('[data-error-resolve]').click(); await tick(); check('Mark resolved sends the id', did.some(d => d.action === 'error-resolve' && d.id === '1' && d.resolved === true));
did.length = 0; $('[data-error-test]').click(); await tick(); check('the test button asks for a test error and says an email is on its way', did.some(d => d.action === 'error-test') && /email is on its way/.test($('.msg').textContent));
$('[data-errtab=resolved]').click(); await tick(); check('the Resolved tab asks for resolved errors and has an empty state', did.some(d => d.action === 'errors' && d.state === 'resolved') && /Nothing resolved yet/.test($('[data-errors]').textContent));
$('[data-nav=status]').click(); await tick();
check('the status page lists components, marks the live-checked one, and lists incidents', $$('[data-component]').length === 2 && /Live check/.test($('[data-component="1"]').textContent) && !$('[data-component="1"] .danger') && $$('[data-incident]').length === 1 && $('[data-open-status]').getAttribute('href') === '/status');
did.length = 0; const sel = $('[data-component="2"] select'); sel.value = 'degraded'; [...$('[data-component="2"]').querySelectorAll('button')].find(x => x.textContent === 'Save').click(); await tick();
check('a component’s status can be set by hand', did.some(d => d.action === 'status-component-save' && d.id === 2 && d.status === 'degraded' && d.visible === true));
did.length = 0; $('input[aria-label="Incident title"]').value = 'Email delays'; $('textarea[aria-label="First update"]').value = 'Looking into it.'; $('.checks input[aria-label=Email]').checked = true; $('[data-post-incident]').click(); await tick();
check('an incident is posted with its title, first update and affected components', did.some(d => d.action === 'status-incident-create' && d.title === 'Email delays' && d.body === 'Looking into it.' && d.componentIds.join() === '2' && d.kind === 'incident'));
did.length = 0; $('[data-incident="7"] input[aria-label="Update text"]').value = 'Fixed.'; $('[data-incident="7"] select[aria-label="New status"]').value = 'resolved'; $('[data-post-update="7"]').click(); await tick();
check('an update can resolve it', did.some(d => d.action === 'status-incident-update' && d.id === 7 && d.status === 'resolved' && d.body === 'Fixed.'));
const kind = $('select[aria-label=Type]'); kind.value = 'maintenance'; kind.dispatchEvent(new w.Event('change')); check('choosing maintenance shows the schedule', !$('input[aria-label=Starts]').parentElement.parentElement.hasAttribute('hidden'));
$('[data-nav=logging]').click(); await tick(); check('logging says Axiom is connected and to which dataset, and that no other drain is set', /effdesk/.test($('[data-logging]').textContent) && /LOG_DRAIN_URL/.test($('[data-logging]').textContent));
$('[data-logging-test]').click(); await tick(); check('the logging test shows what Axiom answered', /axiom: refused \(401\)/.test($('[data-logging-result]').textContent));
$('[data-nav=settings]').click(); await tick(); did.length = 0;
$('input[aria-label="Announcement text"]').value = 'Maintenance tonight'; $('input[aria-label="Show the announcement"]').checked = true; $('select[aria-label=Tone]').value = 'warn'; $('[data-save-announcement]').click(); await tick();
check('the announcement is saved with its tone', did.some(d => d.action === 'settings-save' && d.announcement.active === true && d.announcement.text === 'Maintenance tonight' && d.announcement.tone === 'warn') && /live in every desk/.test($('.msg').textContent));
did.length = 0; $('input[aria-label="Allow new sign-ups"]') || 0; $('input[aria-label="Allow new workspaces"]').checked = false; $('[data-save-signups]').click(); await tick(); check('sign-ups can be paused', did.some(d => d.action === 'settings-save' && d.signups.open === false) && /paused/.test($('.msg').textContent));
$('[data-nav=users]').click(); $('input[aria-label="Search people"]').value = 'olivia'; did.length = 0; $('[data-user-search]').click(); await tick();
check('people show with workspaces and sessions', /Acme \(owner\)/.test($('[data-user]').textContent) && /2 active sessions/.test($('[data-user]').textContent) && /Not verified/.test($('[data-user]').textContent));
$('[data-signout=u1]').click(); await tick(); check('Sign out everywhere sends the user', did.some(d => d.action === 'user-signout' && d.userId === 'u1'));
$('[data-nav=activity]').click(); await tick(); check('activity shows who did what', /customer\.suspend/.test($('[data-activity]').textContent) && /boss@effdesk\.test/.test($('[data-activity]').textContent));
// one customer's controls
const box = w.document.createElement('div'); const P = w.EffDeskAdminPanels.make({ el: (t, p, ...c) => { const e = w.document.createElement(t); Object.keys(p || {}).forEach(k => k === 'class' ? e.className = p[k] : k.indexOf('on') === 0 ? e.addEventListener(k.slice(2), p[k]) : e.setAttribute(k, p[k])); c.flat().forEach(x => x != null && x !== false && e.appendChild(typeof x === 'string' ? w.document.createTextNode(x) : x)); return e; }, act: (a, b) => fetchFn('/api/admin/do', { body: JSON.stringify({ action: a, ...b }) }).then(async r => ({ ok: r.ok, status: r.status, body: await r.json() })), say() { }, doc: w.document });
const c = P.customerControls('acme'); w.document.body.appendChild(c); await tick();
check('a customer’s limits show what is set and per-feature choices', c.querySelector('input[aria-label="Seat limit"]').value === '7' && c.querySelector('select[aria-label=whatsapp]').value === 'off' && c.querySelector('select[aria-label=sso]').value === 'plan' && /Effective plan: pro/.test(c.textContent));
did.length = 0; c.querySelector('input[aria-label="Seat limit"]').value = '9'; c.querySelector('select[aria-label=sso]').value = 'on'; c.querySelector('[data-save-overrides]').click(); await tick();
check('saving sends the limits, the features turned on and off, and the note', did.some(d => d.action === 'customer-save' && d.slug === 'acme' && d.seatLimit === '9' && d.mailPerDay === '' && d.featuresOn.join() === 'sso' && d.featuresOff.join() === 'whatsapp' && d.note === 'hi'));
did.length = 0; c.querySelector('input[aria-label="Reason for suspending"]').value = 'Payment dispute'; c.querySelector('[data-suspend]').click(); await tick();
check('suspending sends the reason', did.some(d => d.action === 'customer-suspend' && d.suspended === true && d.reason === 'Payment dispute'));
done();
