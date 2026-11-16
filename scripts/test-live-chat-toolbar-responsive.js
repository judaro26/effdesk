import fs from 'node:fs';
import assert from 'node:assert/strict';

const css = fs.readFileSync(new URL('../public/css/desk-polish.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/desk.html', import.meta.url), 'utf8');

assert.match(css, /\.chat-agent-workspace \.chat-agent-conversation \.chtools\s*\{[^}]*display:grid/s);
assert.match(css, /\.chat-agent-workspace \.chat-agent-conversation \.conversation-filter\s*\{[^}]*display:grid/s);
assert.match(css, /\.conversation-filter \.conversation-search\s*\{[^}]*min-width:0/s);
assert.match(css, /@media\s*\(max-width:\s*640px\)/);
assert.match(css, /\.compose \.modes\s*\{[^}]*flex-wrap:wrap/s);
assert.match(css, /\.compose \.ed-bar/);
assert.match(html, /desk-polish\.css\?v=live-chat-toolbar-responsive-20261116/);

assert.equal((css.match(/\{/g)||[]).length, (css.match(/\}/g)||[]).length, 'CSS braces are balanced');
console.log('✓ Live Chat toolbar wrapping, narrow filter layout, and stylesheet cache key are covered.');
