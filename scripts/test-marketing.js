// scripts/test-marketing.js: THE PUBLIC PAGES: prices match the plans, themes match the desk, nothing loads from outside, features that do not exist yet say "Soon", and the developer guide covers every API route.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { check, done } from './lib/check.js';
import { PLANS } from '../src/plans.js'; import { THEMES } from '../src/themes.js';
const pub = f => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', f), 'utf8');
const home = pub('index.html'), dev = pub('developers.html'), css = pub('css/marketing.css');
check('the home page shows each paid plan\'s yearly price and monthly price', ['team', 'suite', 'pro'].every(k => home.includes(`$${PLANS[k].price.year}<small>`) && home.includes(`$${PLANS[k].price.month} billed monthly`)));
check('the home page shows every theme once, with its plan', THEMES.every(t => home.includes(`<p>${t.name}<span>${t.premium ? 'Paid' : 'Free'}</span></p>`)) && (home.match(/class="th"/g) || []).length === THEMES.length);
check('no page loads a script, style, font or picture from another site (the content security policy would block it)', [home, dev, css].every(t => !/(src|href)="https?:\/\/(?!app\.effdesk\.com)/.test(t) && !/url\(\s*['"]?https?:/.test(t) && !/@import/.test(t)));
check('features that are not built yet are marked Soon, not sold as ready', /Single sign-on <span class="soon">Soon/.test(home) && /Custom roles <span class="soon">Soon/.test(home) && /AI assist<\/th>(<td>.*?<\/td>){2}<td><span class="soon">Soon/.test(home) && /Live chat/.test(home));
check('the home page links to the developer guide and the guide links back', home.includes('href="/developers.html"') && dev.includes('href="/#pricing"'));
check('every page has a title, a description and works on a phone', [home, dev].every(t => /<title>.+<\/title>/.test(t) && /name="description"/.test(t) && /name="viewport"/.test(t)));
check('the guide documents every API route and the webhook signature', ['/tickets', '/tickets/{number}', '/tickets/{number}/comments', 'X-EffDesk-Signature', 'X-EffDesk-Timestamp', 'ticket.created', 'message.customer', 'custom'].every(s => dev.includes(s)));
check('the guide names every webhook event the server sends', ['ticket.created', 'ticket.updated', 'message.agent', 'message.customer', 'ticket.mentioned'].every(e => dev.includes(`<code>${e}</code>`)));
check('headings are in order and the page does not trap keyboard focus (focus rings are defined)', /:focus-visible/.test(css) && (home.match(/<h1/g) || []).length === 1 && (dev.match(/<h1/g) || []).length === 1);
done();
