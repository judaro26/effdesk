import fs from 'node:fs';
import assert from 'node:assert/strict';

const css = fs.readFileSync(new URL('../public/css/desk-polish.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/desk.html', import.meta.url), 'utf8');

assert.match(css, /@media\s*\(max-width:\s*1120px\)/, 'tablet layout breakpoint is present');
assert.match(css, /@media\s*\(max-width:\s*760px\)/, 'compact layout breakpoint is present');
assert.match(css, /\.chat-agent-workspace \.chat-agent-conversation\.ticket\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/s, 'Live Chat conversation uses a single primary column');
assert.match(css, /\.chat-agent-workspace \.chat-agent-conversation>\.props\{display:none!important\}/, 'empty ticket properties rail is removed from Live Chat');
assert.match(css, /\.chat-agent-workspace \.chat-agent-conversation>\.info\s*\{[^}]*grid-row:2/s, 'requester context follows the conversation');
assert.match(css, /\.chat-agent-head-actions\s*\{[^}]*flex-wrap:wrap/s, 'conversation actions wrap instead of overflowing');
assert.match(css, /\.chat-agent-conversation>\.info\s*\{[^}]*grid-column:1\/-1/s, 'context panel moves below the conversation on tablet widths');
assert.match(css, /\.chat-agent-conversation>\.conv \.thread\s*\{[^}]*overflow:auto!important/s, 'message thread remains independently scrollable on narrow screens');
assert.match(css, /\.chat-agent-conversation>\.conv \.compose\s*\{[^}]*position:relative/s, 'composer remains in normal flow on narrow screens');
assert.match(css, /min-width:0/, 'flex and grid children are allowed to shrink');
assert.match(html, /desk-polish\.css\?v=responsive-live-chat-window-20261116/, 'desk page uses the refreshed stylesheet cache key');

const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
assert.equal(opens, closes, 'stylesheet has balanced rule braces');

console.log('✓ Responsive Live Chat layout breakpoints, reflow, scrolling, and cache key are covered.');
