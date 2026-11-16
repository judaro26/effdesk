// Lightweight source-level guardrails for live visitor page context refresh.
import { readFileSync } from 'node:fs';
import { check, done } from './lib/check.js';
const js = readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
check('the agent workspace refreshes the current visitor page during the existing Live Chat inbox refresh cycle', js.includes('function refreshChatVisitorPage(number)') && js.includes("api('get', { number: number, messageLimit: 1 })") && js.includes('refreshChatVisitorPage(current.ticket.number)'));
check('the visitor page context is labelled as current for chats and as submission context for other tickets', js.includes("chatConversationOpen?'Current page':'Page at submission'"));
done();
