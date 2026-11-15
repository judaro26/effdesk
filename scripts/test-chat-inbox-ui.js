import fs from 'node:fs';
import { check, done } from './lib/check.js';

const js = fs.readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/desk.css', import.meta.url), 'utf8');

check('the waiting queue is presented as New chats', js.includes("panel('New chats', 'First come, first served · oldest waiting first'"));
check('new unassigned conversations receive a visible NEW marker', js.includes("'chat-inbox-new-label'") && js.includes("'is-new'"));
check('the new-chat queue receives its own visual treatment', css.includes('.deskapp .chat-inbox-panel-new') && css.includes('.deskapp .chat-inbox-new-label'));
check('manual refresh keeps already-loaded conversations visible', js.includes('chatInboxLoading && !chatInboxPrimed'));
check('waiting conversations remain oldest-first', js.includes("new Date(a.created_at || a.updated_at || 0) - new Date(b.created_at || b.updated_at || 0)"));
check('assigned conversations keep customer replies ahead of recent activity', js.includes('return bNeedsReply - aNeedsReply || new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)'));
check('the inbox remains responsive on narrow screens', css.includes('@media(max-width:560px)') && css.includes('.chat-inbox-columns{grid-template-columns:1fr}'));

done();
