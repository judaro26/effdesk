import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html lang="en"><body><header><nav></nav></header><main><h1>Dashboard</h1><button title="Search tickets">Search tickets</button><input placeholder="Search tickets, contacts, companies, agents…"><div class="mt">Open</div></main></body></html>', {
  url: 'https://app.effdesk.com/',
  runScripts: 'outside-only'
});
dom.window.eval(source);
const { document, EffI18n } = dom.window;
assert.equal(EffI18n.getLocale(), 'en');

EffI18n.setLocale('es');
assert.equal(document.documentElement.lang, 'es');
assert.equal(document.querySelector('h1').textContent, 'Panel principal');
assert.equal(document.querySelector('button').textContent, 'Buscar tickets');
assert.equal(document.querySelector('button').title, 'Buscar tickets');
assert.equal(document.querySelector('input').placeholder, 'Buscar tickets, contactos, empresas y agentes…');
assert.equal(document.querySelector('.mt').textContent, 'Open', 'ticket conversation content must not be translated');

const dynamic = document.createElement('section');
dynamic.innerHTML = '<h2>Conversation tools</h2><p>Write a public reply. The customer is emailed.</p><button title="Refresh">Refresh</button>';
document.querySelector('main').appendChild(dynamic);
await new Promise(resolve => dom.window.queueMicrotask(resolve));
assert.equal(dynamic.querySelector('h2').textContent, 'Herramientas de conversación', 'newly rendered agent UI is translated');
assert.equal(dynamic.querySelector('p').textContent, 'Escribe una respuesta pública. Se enviará un correo electrónico al cliente.');
assert.equal(dynamic.querySelector('button').title, 'Actualizar', 'newly rendered attributes are translated');
const manageLabel = document.createElement('h2');
manageLabel.textContent = 'Ticket statuses';
const integrationLabel = document.createElement('h2');
integrationLabel.textContent = 'External integrations';
const dynamicGreeting = document.createElement('p');
dynamicGreeting.textContent = 'Good morning, Ana';
const dynamicConnection = document.createElement('p');
dynamicConnection.textContent = 'Connected as ana@example.com.';
document.querySelector('main').append(manageLabel, integrationLabel, dynamicGreeting, dynamicConnection);
await new Promise(resolve => dom.window.queueMicrotask(resolve));
assert.equal(manageLabel.textContent, 'Estados de los tickets', 'Manage workspace sections are translated');
assert.equal(integrationLabel.textContent, 'Integraciones externas', 'external integration hub headings are translated');
assert.equal(dynamicGreeting.textContent, 'Buenos días, Ana', 'dynamic dashboard greetings retain the agent name');
assert.equal(dynamicConnection.textContent, 'Conectado como ana@example.com.', 'dynamic integration account details retain the account value');
assert.equal(EffI18n.t('Awaiting approval', 'es'), 'Pendiente de aprobación', 'built-in ticket workflow statuses are translated');

EffI18n.setLocale('en');
assert.equal(document.querySelector('h1').textContent, 'Dashboard');
assert.equal(document.querySelector('button').textContent, 'Search tickets');
assert.equal(dynamic.querySelector('h2').textContent, 'Conversation tools', 'dynamically rendered UI can switch back to English');
assert.equal(dynamic.querySelector('p').textContent, 'Write a public reply. The customer is emailed.');
assert.equal(document.documentElement.lang, 'en');
assert.equal(EffI18n.t('Unknown future label', 'es'), 'Unknown future label', 'unknown strings safely fall back to source text');
dom.window.close();
console.log('✓ Spanish localization switches both ways, translates dynamic UI and attributes, and preserves user-authored content');
