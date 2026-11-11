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
done();
