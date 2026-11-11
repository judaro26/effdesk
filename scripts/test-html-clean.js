// scripts/test-html-clean.js: ARTICLE HTML IS SAFE: the allow-list, links, pictures, video, table of contents.
import { check, done } from './lib/check.js';
import { clean, withToc, videoEmbed, plainOf } from '../src/html-clean.js';
const dirty = '<h1>Title</h1><p onclick="x()" style="color:red">a <b>b</b><script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://e.com" onclick="y()">ok</a></p><img src=x onerror=alert(1)><img src="https://e.com/a.png" width="100" height="abc" style="x:y"><img src="/help/acme/img/123e4567-e89b-12d3-a456-426614174000"><img src="data:image/svg+xml;base64,AAAA"><iframe src="https://evil.com/embed/1"></iframe><iframe src="https://www.youtube-nocookie.com/embed/abc123def" onload="z()"></iframe><div class="callout info evil" style="color:red">c</div><form action="x"><input name="p"></form><svg onload=1></svg><video src="https://e.com/v.mp4" controls autoplay></video><video src="javascript:1"></video><style>p{}</style><object data="x"></object>';
const out = clean(dirty);
check('scripts, styles, event handlers, forms, svg and objects are gone', !/<script|onclick|onerror|onload|style=|<form|<input|<svg|<style|<object|alert\(1\)<\/script>/i.test(out) && !/autoplay/.test(out));
check('h1 becomes h2 so the page keeps one title', /<h2>Title<\/h2>/.test(out) && !/<h1/.test(out));
check('javascript: links lose the link but keep the text, https links open safely', !/javascript:/.test(out) && /bad/.test(out) && /<a href="https:\/\/e\.com" target="_blank" rel="noopener noreferrer">ok<\/a>/.test(out));
check('pictures: https and our own uploads stay; broken, data: and relative-elsewhere are removed', /<img src="https:\/\/e\.com\/a\.png" width="100"/.test(out) && /img\/123e4567-e89b-12d3-a456-426614174000/.test(out) && !/data:image/.test(out) && !/src="x"/.test(out) && !/height="abc"/.test(out));
check('videos: only YouTube, Vimeo and Loom embeds; others are removed', /youtube-nocookie\.com\/embed\/abc123def/.test(out) && !/evil\.com/.test(out) && /<video src="https:\/\/e\.com\/v\.mp4"/.test(out) && !/javascript:1/.test(out));
check('only known classes survive', /<div class="callout info">c<\/div>/.test(out) && !/evil/.test(out));
check('a link without an address is dropped and mailto works', !/<a>/.test(clean('<a>x</a>')) && /mailto:a@b\.co/.test(clean('<a href="mailto:a@b.co">m</a>')));
check('tables, lists, code, quotes and details are kept', ['<table><tr><td>1</td></tr></table>', '<ul><li>a</li></ul>', '<pre><code>x</code></pre>', '<blockquote>q</blockquote>', '<details><summary>s</summary>d</details>'].every(h => clean(h).replace(/<\/?tbody>/g, '') === h));
const t = withToc('<h2>One two</h2><p>x</p><h3>One two</h3><h2><em>Third</em></h2>');
check('headings get ids and a table of contents, repeats get a number', t.toc.length === 3 && t.toc[0].id === 'one-two' && t.toc[1].id === 'one-two-2' && /<h3 id="one-two-2">/.test(t.html) && t.toc[2].text === 'Third');
check('video links become embeds', videoEmbed('https://youtu.be/dQw4w9WgXcQ') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && videoEmbed('https://vimeo.com/123456789') === 'https://player.vimeo.com/video/123456789' && videoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef') === 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
check('other links, http and junk are not videos', videoEmbed('https://evil.com/watch?v=abcdefgh') === null && videoEmbed('http://youtu.be/dQw4w9WgXcQ') === null && videoEmbed('nonsense') === null);
check('plain text strips tags', plainOf('<h2>Hi</h2><p>a&nbsp;<b>b</b></p>') === 'Hi a b');
done();
