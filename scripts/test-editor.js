// scripts/test-editor.js: THE MESSAGE EDITOR IN A REAL BROWSER: the toolbar and the typing shortcuts really format the text, and the text underneath comes out as message markers. Skipped when no browser is installed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { check, done } from './lib/check.js';
let chromium; try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { console.log('skip: playwright is not installed'); process.exit(0); }
let browser; try { browser = await chromium.launch(); } catch { console.log('skip: no browser available'); process.exit(0); }
const read = f => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const page = await browser.newPage();
await page.setContent('<main><textarea id="t" aria-label="Message" placeholder="Write"></textarea></main>');
await page.addScriptTag({ content: read('js/format.js') }); await page.addScriptTag({ content: read('js/editor.js') });
await page.evaluate(() => { const t = document.getElementById('t'); t.parentNode.appendChild(EffEditor.enhance(document, t, { onImages(f) { window.__imgs = f.length; } })); });
const val = () => page.evaluate(() => document.getElementById('t').value);
if (process.env.DBG) page.on('console', m => console.log(m.text()));
const area = page.locator('[data-editor]'), clear = async () => { await page.evaluate(() => document.querySelector('.ed')._set('')); await area.click(); };
check('the editor has a toolbar with the full set of buttons', await page.locator('.ed-btn').count() >= 15 && await page.locator('select[data-cmd=h]').count() === 1);
await area.click(); await page.keyboard.press('Control+B'); await page.keyboard.type('bold'); await page.keyboard.press('Control+B'); await page.keyboard.type(' plain ');
await page.keyboard.press('Control+I'); await page.keyboard.type('it'); await page.keyboard.press('Control+I');
check('Ctrl+B and Ctrl+I make **bold** and _italic_ text', /^\*\*bold\*\* plain _it_$/.test((await val()).trim()));
await clear(); await page.keyboard.type('hi'); await page.locator('[data-cmd=underline]').click(); await page.keyboard.type('under'); await page.locator('[data-cmd=underline]').click();
check('the underline button makes ++underlined++ text', /^hi\+\+under\+\+$/.test((await val()).trim()));
await clear(); await page.keyboard.type('above'); await page.keyboard.press('Enter'); await page.keyboard.type('---'); await page.keyboard.press('Enter'); await page.keyboard.type('below');
check('--- then Enter draws a line', await page.locator('.ed-area hr').count() === 1 && /above\n\n---\n\nbelow/.test(await val()));
await clear(); await page.keyboard.type('```'); await page.keyboard.press('Enter'); await page.keyboard.type('a < b'); await page.keyboard.press('Enter'); await page.keyboard.type('c');
check('``` then Enter starts a code block that keeps its lines', await page.locator('.ed-area pre').count() === 1 && /```\na < b\nc\n```/.test(await val()));
await clear(); await page.keyboard.type('- '); await page.keyboard.type('one'); await page.keyboard.press('Enter'); await page.keyboard.type('two');
check('"- " starts a bulleted list', await page.locator('.ed-area ul li').count() === 2 && /^- one\n- two$/.test((await val()).trim()));
await clear(); await page.keyboard.type('# '); await page.keyboard.type('Title');
check('"# " starts a heading', /^# Title$/.test((await val()).trim()));
await clear(); await page.locator('[data-cmd=insertOrderedList]').click(); await page.keyboard.type('x'); await page.keyboard.press('Enter'); await page.keyboard.type('y');
check('the numbered list button numbers the lines', /^1\. x\n2\. y$/.test((await val()).trim()));
await clear(); await page.locator('[data-cmd=table]').click();
check('the table button adds a table', await page.locator('.ed-area table').count() === 1 && /\| Column 1 \| Column 2 \|/.test(await val()));
await clear(); await page.keyboard.type('see '); await page.locator('[data-cmd=link]').click(); await page.locator('.ed-link input').fill('example.com/x'); await page.keyboard.press('Enter');
check('the link button adds a link (https is added)', /\[https:\/\/example\.com\/x\]\(https:\/\/example\.com\/x\)/.test(await val()));
await clear(); await page.evaluate(() => { const a = document.querySelector('[data-editor]'); a.focus(); const dt = new DataTransfer(); dt.setData('text/html', '<table><tr><th>Item</th><th>Qty</th></tr><tr><td>Bolt</td><td>4</td></tr></table><script>1</script>'); dt.setData('text/plain', 'Item\tQty\nBolt\t4'); a.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
check('a pasted table stays a table and scripts are dropped', await page.locator('.ed-area table td').count() >= 2 && !(await page.locator('.ed-area script').count()) && /\| Bolt \| 4 \|/.test(await val()));
await clear(); await page.evaluate(() => { const a = document.querySelector('[data-editor]'); a.focus(); const dt = new DataTransfer(); dt.items.add(new File(['x'], 'p.png', { type: 'image/png' })); a.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
check('a pasted picture goes to the attachments, not into the text', await page.evaluate(() => window.__imgs) === 1);
await browser.close(); done();
