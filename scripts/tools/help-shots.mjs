// scripts/tools/help-shots.mjs: renders the help center home and a rich article in chosen themes and widths, to PNG files, for a visual check. Usage: node scripts/tools/help-shots.mjs <outdir> [theme,theme] 
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
import * as pages from '../../src/help-pages.js'; import { clean, withToc } from '../../src/html-clean.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), out = process.argv[2] || '/tmp/hc', themes = (process.argv[3] || 'classic,aurora,midnight').split(',');
const { chromium } = createRequire('/opt/npm-tools/')('playwright');
fs.mkdirSync(out, { recursive: true });
const PIC = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='420'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23ffbe3d'/%3E%3Cstop offset='1' stop-color='%23f23d5c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='420' fill='url(%23g)'/%3E%3C/svg%3E";       // the sample picture is drawn locally so no network is needed
const art = fs.readFileSync(path.join(root, 'scripts/fixtures/sample-article.html'), 'utf8');
const rich = withToc(clean(art));
const arts = [['Getting started', 'Create your account', 'Sign up and invite your team in minutes.', 120], ['Getting started', 'Invite teammates', 'Add agents and set their roles.', 80], ['Billing', 'Understand your invoice', 'Where each line comes from.', 200], ['Billing', 'Change your plan', 'Upgrade or downgrade at any time.', 60], ['Billing', 'Update payment details', 'Cards and receipts.', 10], ['Troubleshooting', 'Emails are not arriving', 'Check these five things first.', 150], ['', 'Contact support', 'We reply within a day.', 5]].map(([category, title, excerpt, views], i) => ({ id: 'a' + i, slug: 'a' + i, lang: 'en', title, category, excerpt, views, updated_at: new Date('2026-11-01') }));
const browser = await chromium.launch();
for (const theme of themes) {
  const org = { name: 'Acme', slug: 'acme', look: { theme, accent: '', hero_title: 'How can we help you today?', hero_subtitle: 'Search our guides or browse by topic.' } };
  const home = pages.homePage({ org, lang: 'en', base: '/help/acme', articles: arts, statusLink: true });
  const a = { ...arts[0], title: 'Create your account and invite your team', updated_at: new Date('2026-11-05') };
  const article = pages.articlePage({ org, lang: 'en', base: '/help/acme', a, html: rich.html, toc: rich.toc, related: arts.slice(1, 4), translations: [], statusLink: true });
  for (const [name, html] of [['home', home], ['article', article]]) {
    const fixed = html.replace(/https:\/\/pictures\.test\/signup\.png/g, PIC).replace(/href="\/css\//g, `href="file://${root}/public/css/`);
    const file = path.join(out, `${theme}-${name}.html`); fs.writeFileSync(file, fixed);
    for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 }), pg = await ctx.newPage();
      await pg.goto('file://' + file); await pg.screenshot({ path: path.join(out, `${theme}-${name}-${label}.png`), fullPage: true }); await ctx.close();
    }
  }
}
await browser.close(); console.log('done', out);
