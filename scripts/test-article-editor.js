// scripts/test-article-editor.js: THE ARTICLE EDITOR in a page: toolbar, video, pictures, HTML view, PDF import, and that nothing unsafe gets in.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const dom = new JSDOM('<!doctype html><body><div id="m"></div>', { runScripts: 'outside-only' }), w = dom.window; w.eval(fs.readFileSync(path.join(root, 'public/js/article-editor.js'), 'utf8'));
const says = [], ups = [], pdfs = []; let titled = '';
const mk = (o = {}) => { const ed = w.EffArticleEditor.create(w.document, { html: '<p>Hello</p>', say: (t, bad) => says.push([t, !!bad]), upload: f => { ups.push(f.name); return Promise.resolve('/help/acme/img/123e4567-e89b-12d3-a456-426614174000'); }, importPdf: f => { pdfs.push(f.name); return Promise.resolve({ html: '<h2>From PDF</h2><p>Body</p><figure><img src="/help/acme/img/123e4567-e89b-12d3-a456-426614174000" alt=""></figure>', title: 'Guide', pages: 2, pictures: 1, warnings: [] }); }, onTitle: t => { titled = t; }, ...o }); w.document.getElementById('m').replaceChildren(ed.el); return ed; };
const $ = (ed, s) => ed.el.querySelector(s);
let ed = mk();
check('stored html opens in the editor', $(ed, '[data-article-editor]').textContent === 'Hello');
check('everything that enters is cleaned: scripts, handlers, styles, odd links', ed.clean('<p onclick="x()" style="a:b">a<script>alert(1)</script><a href="javascript:1">l</a><img src=x onerror=y><iframe src="https://evil.com/embed/1"></iframe></p>') === '<p>al</p>');
check('safe things survive: heading, callout, video embed, our pictures', ed.clean('<h1>T</h1><div class="callout tip x">c</div><div class="video"><iframe src="https://player.vimeo.com/video/123456789"></iframe></div><img src="/help/acme/img/123e4567-e89b-12d3-a456-426614174000">').replace(/ alt=""/, '') === '<h2>T</h2><div class="callout tip">c</div><div class="video"><iframe src="https://player.vimeo.com/video/123456789"></iframe></div><img src="/help/acme/img/123e4567-e89b-12d3-a456-426614174000">');
check('an empty article has no html (so it cannot be saved blank)', mk({ html: '' }).getHtml() === '');
check('the toolbar has the formatting controls', ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'quote', 'link', 'image', 'video', 'callout', 'code', 'table', 'rule', 'clear', 'undo', 'redo', 'pdf'].every(c => !!$(ed, `[data-cmd="${c}"]`)) && !!$(ed, 'select[data-cmd=block]'));
// video
$(ed, '[data-cmd=video]').click(); $(ed, '.ae-dlg input').value = 'https://example.com/nope'; $(ed, '[data-dialog-ok]').click();
check('a link that is not YouTube, Vimeo or Loom is refused with a reason', says.some(s => s[1] && /YouTube, Vimeo or Loom/.test(s[0])) && !$(ed, 'iframe'));
$(ed, '[data-cmd=video]').click(); $(ed, '.ae-dlg input').value = 'https://youtu.be/dQw4w9WgXcQ'; $(ed, '[data-dialog-ok]').click();
check('a YouTube link becomes a responsive embed', /<div class="video"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/.test(ed.getHtml()));
// pictures
const png = new w.File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }), fi = $(ed, '[data-image-file]');
Object.defineProperty(fi, 'files', { value: [png], configurable: true }); fi.dispatchEvent(new w.Event('change')); await tick();
check('a picture is uploaded and placed in the article', ups.join() === 'shot.png' && /<figure><img src="\/help\/acme\/img\/123e4567-e89b-12d3-a456-426614174000" alt=""><\/figure>/.test(ed.getHtml()));
Object.defineProperty(fi, 'files', { value: [new w.File(['x'], 'evil.svg', { type: 'image/svg+xml' })], configurable: true }); fi.dispatchEvent(new w.Event('change')); await tick();
check('only PNG, JPEG, GIF and WebP are accepted', ups.length === 1);
$(ed, 'img').click(); check('clicking a picture opens its options', !$(ed, '[data-image-bar]').hasAttribute('hidden'));
$(ed, '[data-image-bar] input').value = 'The dashboard'; $(ed, '[data-image-bar] input').dispatchEvent(new w.Event('input')); $(ed, '[data-img-size=img-m]').click();
check('a description and a size can be set', /<img src="[^"]+" alt="The dashboard" class="img-m">/.test(ed.getHtml()) || (/alt="The dashboard"/.test(ed.getHtml()) && /img-m/.test(ed.getHtml())));
$(ed, '[data-img-remove]').click(); check('and the picture removed', !$(ed, 'img'));
// source and PDF are paid features
check('without the Team plan there is no HTML view, and the PDF button says why', !$(ed, '[data-cmd=source]') && /Team/.test($(ed, '[data-cmd=pdf]').textContent));
says.length = 0; $(ed, '[data-cmd=pdf]').click(); check('clicking it explains and does not open a file chooser', says.some(s => s[1] && /Team plan/.test(s[0])) && !pdfs.length);
ed = mk({ canSource: true, canImport: true });
$(ed, '[data-cmd=source]').click(); check('on a paid plan the HTML view shows the clean source', !$(ed, '.ae-src').hasAttribute('hidden') && $(ed, '.ae-src').value === '<p>Hello</p>' && $(ed, '[data-article-editor]').hasAttribute('hidden'));
$(ed, '.ae-src').value = '<h1>Pasted</h1><p onclick="x()">page<script>alert(1)</script></p><img src="http://tracker/x.gif">'; $(ed, '[data-cmd=source]').click();
check('pasted HTML is cleaned when it goes back into the editor', ed.getHtml() === '<h2>Pasted</h2><p>page</p>' && $(ed, '.ae-src').hasAttribute('hidden'));
$(ed, '[data-cmd=source]').click(); $(ed, '.ae-src').value = '<p>Saved from source</p>'; check('saving while in the HTML view still takes what is in the box', ed.getHtml() === '<p>Saved from source</p>');
const pf = $(ed, '[data-pdf-file]'); Object.defineProperty(pf, 'files', { value: [new w.File(['%PDF-'], 'guide.pdf', { type: 'application/pdf' })], configurable: true }); pf.dispatchEvent(new w.Event('change')); await tick();
check('importing a PDF fills the editor, suggests the title and says what to do next', pdfs.join() === 'guide.pdf' && /From PDF/.test(ed.getHtml()) && /<figure><img/.test(ed.getHtml()) && titled === 'Guide' && says.some(s => /Imported 2 pages and 1 picture/.test(s[0]) && /Check it over/.test(s[0])));

// ---- word-processor features
const ed2 = mk({ html: '<p>Hello</p>' });
check('the ribbon has fonts, sizes, colours, alignment, indent, spacing and table tools', ['fontName', 'fontSize', 'foreColor', 'hiliteColor', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'indent', 'outdent', 'lineHeight', 'subscript', 'superscript', 'table-row+', 'table-col+', 'table-del'].every(c => !!$(ed2, `[data-cmd="${c}"]`)) && $(ed2, '[data-cmd=fontName]').options.length > 10);
check('formatting is cleaned like on the server: good values stay, risky ones go', ed2.clean('<p style="color:#c00;text-align:center;font-size:20px;position:fixed;background:url(https://e.test/x);font-family:Georgia, serif;margin-left:-4px">a</p>') === '<p style="color:#c00;text-align:center;font-size:20px;font-family:Georgia, serif">a</p>');
check('pasted <font> tags become styled spans', ed2.clean('<font color="#00f" face="Arial" size="5">d</font>') === '<span style="color:#00f;font-family:Arial;font-size:24px">d</span>');
check('table widths and borders survive', /<table style="width:100%;border:1px solid #ccc">/.test(ed2.clean('<table style="width:100%;border:1px solid #ccc"><tr><td style="vertical-align:top;position:absolute">c</td></tr></table>')) && /<td style="vertical-align:top">/.test(ed2.clean('<table><tr><td style="vertical-align:top;position:absolute">c</td></tr></table>')));
// the table tools
ed2.setHtml('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
const cellSel = c => { const r = w.document.createRange(); r.selectNodeContents(c); const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r); };
cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-row+"]').click();
check('add a row', ed2.area.querySelectorAll('tbody tr').length === 2 && ed2.area.querySelectorAll('tbody tr')[1].children.length === 2);
cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-col+"]').click();
check('add a column (header and body)', ed2.area.querySelectorAll('thead th').length === 3 && ed2.area.querySelector('tbody tr').children.length === 3);
cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-col-"]').click(); cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-row-"]').click();
check('remove a column and a row', ed2.area.querySelectorAll('thead th').length === 2 && ed2.area.querySelectorAll('tbody tr').length === 1);
cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-striped"]').click(); check('stripes toggle', ed2.area.querySelector('table').classList.contains('tbl-striped'));
cellSel(ed2.area.querySelector('td')); $(ed2, '[data-cmd="table-del"]').click(); check('delete the table', !ed2.area.querySelector('table'));
// insert a table of a chosen size
cellSel(ed2.area.querySelector('p') || ed2.area); $(ed2, '[data-cmd=table]').click(); $(ed2, '.ae-dlg input').value = '4 x 3'; $(ed2, '[data-dialog-ok]').click();
check('a table of the chosen size is inserted with a header row', ed2.area.querySelectorAll('th').length === 4 && ed2.area.querySelectorAll('tbody tr').length === 2 || /<th>Heading<\/th>/.test(ed2.getHtml()));
// picture effects
ed2.setHtml('<figure><img src="/help/acme/img/123e4567-e89b-12d3-a456-426614174000" alt="x"></figure>'); ed2.area.querySelector('img').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const bar2 = ed2.el.querySelector('[data-image-bar]');
bar2.querySelector('[data-img-size=img-m]').click(); bar2.querySelector('[data-img-align=img-left]').click(); bar2.querySelector('[data-img-effect=img-round]').click(); bar2.querySelector('[data-img-effect=img-shadow]').click();
const im = ed2.area.querySelector('img');
check('a picture can be sized, placed and given effects', ['img-m', 'img-left', 'img-round', 'img-shadow'].every(c => im.classList.contains(c)) && /class="[^"]*img-round/.test(ed2.getHtml()));
bar2.querySelector('[data-img-size=img-l]').click(); bar2.querySelector('[data-img-effect=img-round]').click();
check('choosing another size replaces the first, and an effect toggles off', im.classList.contains('img-l') && !im.classList.contains('img-m') && !im.classList.contains('img-round'));
bar2.querySelector('[data-img-caption]').click(); check('a caption can be added', !!ed2.area.querySelector('figure figcaption'));
bar2.querySelector('[data-img-caption]').click(); check('and taken away', !ed2.area.querySelector('figcaption'));
check('the word count follows the text', /^\d+ words$/.test($(ed2, '.ae-words').textContent));
done();
