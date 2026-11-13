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
EffI18n.setLocale('en');
assert.equal(document.querySelector('h1').textContent, 'Dashboard');
assert.equal(document.querySelector('button').textContent, 'Search tickets');
assert.equal(document.documentElement.lang, 'en');
dom.window.close();
console.log('✓ interface locale switches both ways and preserves user-authored content');
