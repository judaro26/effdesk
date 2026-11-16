import fs from 'node:fs';
import { check, done } from './lib/check.js';

const js = fs.readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/desk.css', import.meta.url), 'utf8');
const handlers = fs.readFileSync(new URL('../src/handlers.js', import.meta.url), 'utf8');
const themeRegistry = fs.readFileSync(new URL('../src/themes.js', import.meta.url), 'utf8');

check('the waiting queue is presented as New chats', js.includes("panel('New chats', 'First come, first served · oldest waiting first'"));
check('new unassigned conversations receive a visible NEW marker', js.includes("'chat-inbox-new-label'") && js.includes("' is-new'"));
check('the new-chat queue receives its own visual treatment', css.includes('.deskapp .chat-inbox-panel-new') && css.includes('.deskapp .chat-inbox-new-label'));
check('manual refresh keeps already-loaded conversations visible', js.includes('chatInboxLoading && !chatInboxPrimed'));
check('waiting conversations remain oldest-first', js.includes("new Date(a.created_at || a.updated_at || 0) - new Date(b.created_at || b.updated_at || 0)"));
check('assigned conversations keep customer replies ahead of recent activity', js.includes('return bNeedsReply - aNeedsReply || new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)'));
check('the inbox remains responsive on narrow screens', css.includes('@media(max-width:560px)') && css.includes('.chat-inbox-columns{grid-template-columns:1fr}'));


check('new chat cards show a clear waiting-for-agent state and waiting age', js.includes('chat-inbox-waiting-age') && js.includes('Waiting for an agent'));
check('new chat cards remove the redundant Chat prefix from the subject preview', js.includes('chatSubject') && js.includes('replace(/^\\s*chat\\s*:\\s*/i'));
check('accept actions have accessible labels and a distinct disabled state', js.includes("'aria-label': 'Accept chat ' + t.number") && css.includes('.chat-inbox-panel-new .chat-inbox-accept:disabled'));
check('new-chat empty state explains that accepted chats move into progress', js.includes('You’re all caught up') && js.includes('Chats you accept will stay here'));
check('waiting-age and accept styling remain responsive', css.includes('.chat-inbox-waiting-age') && css.includes('@media(max-width:560px)'));


check('the chat inbox loads a bounded server-side page instead of all conversations', js.includes("api('chat-inbox', { limit: chatInboxLimit, cursorMode: true, cursor: chatInboxCursorStack[chatInboxPageIndex] || ''"));
check('background Live Chat reply alerts use a cursor feed instead of repeatedly fetching the first 100 tickets', js.includes("api('chat-reply-alerts', { after: chatReplyCursor || '0' })") && js.includes("api('chat-reply-alerts', { initialize: true })"));
check('the chat inbox exposes customer search and queue filters', js.includes('Search customers, email or ticket') && js.includes("value: 'needs-reply'") && js.includes("value: 'mine'"));
check('the chat inbox offers previous and next page navigation', js.includes('chatInboxCursorStack[chatInboxPageIndex + 1] = chatInboxPageNextCursor') && js.includes('chatInboxPageIndex = Math.max(0, chatInboxPageIndex - 1)'));
check('queue summary cards use server-side totals rather than the current page length', js.includes('String(chatInboxCounts.total)') && js.includes('String(chatInboxCounts.waiting)'));
check('queue controls remain usable on mobile', css.includes('.chat-inbox-pagination') && css.includes('.chat-inbox-search') && css.includes('@media(max-width:560px)'));

done();

check('accepted Live Chat conversations stay in the dedicated Live Chat navigation context', js.includes("chatConversationOpen = r.body.ticket.channel === 'chat'") && js.includes("(chatInboxOpen || chatConversationOpen) ? 'chat'"));
check('agent chat conversations use a dedicated layout rather than the standard ticket sidebars', js.includes("'chat-agent-conversation'") && css.includes('.chat-agent-conversation>.props') && css.includes('.chat-agent-conversation>.info'));
check('the dedicated chat view identifies the visitor and offers a direct return to all conversations', js.includes('LIVE CHAT · CUSTOMER CONVERSATION') && js.includes("'data-back-chat-inbox': '1'") && js.includes('All conversations'));
check('the dedicated agent chat layout is responsive and uses workspace theme tokens', css.includes('.chat-agent-conversation') && css.includes('var(--d-panel)') && css.includes('@media(max-width:760px)'));
check('Live Chat visitor overview shows device, operating system, browser and page context', js.includes('chat-visitor-context-grid') && js.includes('visitorDevice') && js.includes('visitorOs') && js.includes('visitorBrowser') && js.includes('visitorPage'));
check('visitor context clearly labels approximate location as not collected rather than guessing', js.includes('Approximate location is not currently collected') && js.includes('Not available yet'));
check('visitor technical user-agent details are tucked into an expandable section', js.includes('chat-visitor-raw-ua') && js.includes('Technical browser details'));
check('visitor context uses theme-aware responsive styles', css.includes('.chat-visitor-context-grid') && css.includes('@media(max-width:900px)'));


check('dedicated Live Chat mode hides ticket tabs and resets cleanly when leaving a conversation', js.includes('tabsEl.hidden = chatConversationOpen') && js.includes('chatInboxOpen = false; chatConversationOpen = false;'));
check('agents can convert chats into linked regular tickets',js.includes("api('chat-convert-to-ticket'")&&js.includes('Create ticket from chat')&&js.includes('Open ticket #'));
check('ticket requester panel displays submission provenance',js.includes('Submission context')&&js.includes('IP address:')&&js.includes('Page visited'));

check('the Live Chat inbox offers a separate Chat History filter', js.includes("el('option', { value: 'history' }, 'Chat History')") && js.includes('view: chatInboxView'));
check('Chat History renders a dedicated full-width archive instead of the active queues', js.includes("panel('Chat History', 'Most recently resolved or closed first'") && css.includes('.chat-inbox-columns.is-history{grid-template-columns:minmax(0,1fr)}'));
check('historical conversations open for review without offering an Accept action', js.includes('if (history || t.assignee_id) open(t.number)') && js.includes("!history && isWaiting ? el('button'"));
check('history cards show their final resolved or closed status and activity date', js.includes("statusLabel = t.status === 'solved' ? 'Resolved' : t.status === 'closed' ? 'Closed'") && js.includes('activityAt = history ? (t.closed_at || t.solved_at || t.updated_at)'));
check('Chat History uses its own resolved and closed summary counts', js.includes("'Past conversations'") && js.includes('chatInboxCounts.solved') && js.includes('chatInboxCounts.closed'));
check('Chat History refreshes less frequently than the active inbox', js.includes("chatInboxView === 'history' ? 60000 : 15000"));

check('the dedicated chat workspace shows a persistent My chats sidebar beside the active conversation', js.includes('chatWorkspaceSidebar()') && js.includes('chat-workspace-sidebar') && css.includes('.chat-agent-workspace{display:grid;grid-template-columns:248px'));
check('agents can switch between multiple assigned active conversations without leaving the chat workspace', js.includes("api('chat-inbox', { limit: 100, offset: 0, view: 'mine' })") && js.includes('open(t.number);'));
check('the My chats list highlights customer replies and refreshes while the agent is in a chat', js.includes('chat-workspace-unread') && js.includes('chatWorkspaceTimer = root.setTimeout(loadMyChatWorkspace, 15000)'));
check('agents have a confirmed End chat action in the dedicated conversation header', js.includes("'data-agent-end-chat':'1'") && js.includes("update({status:'closed'})"));
check('the multi-chat sidebar collapses into a horizontal switcher on mobile', css.includes('@media(max-width:760px){.chat-agent-workspace{display:flex;flex-direction:column'));

check('the My chats sidebar displays the agent workload against the configured concurrent-chat limit', js.includes('chatWorkspaceCapacity.active') && js.includes('chatWorkspaceCapacity.max') && js.includes('chat slots available'));
check('agents can open a teammate transfer panel from a Live Chat conversation', js.includes("api('chat-team', {})") && js.includes('chatTransferPanel(t.number)'));
check('handoff options show availability and active chat capacity and disable ineligible teammates', js.includes('a.eligible') && js.includes("a.active_chats + '/' + a.max_concurrent"));
check('the agent workspace sends chat availability heartbeats while accepting chats', js.includes("api('chat-heartbeat', {})") && js.includes('root.setInterval(chatHeartbeatTick, 30000)'));
check('the transfer panel is responsive on narrow screens', css.includes('.chat-transfer-panel') && css.includes('@media(max-width:760px){.chat-transfer-panel'));

check('the transfer action is limited in the interface to the assigned agent or workspace administrators', js.includes("t.assignee_id === meId || role === 'owner' || role === 'admin'"));

check('unavailable transfer targets are disabled through the native option property without disabling available targets', js.includes('option.disabled=!a.eligible') && !js.includes('disabled:!a.eligible'));

check('agents can choose a separate personal Live Chat theme without changing their overall desk theme', js.includes("var CHAT_THEMES = [") && js.includes("function applyChatTheme(id)") && js.includes("api('prefs-save', { chatTheme: t.id })"));
check('the Live Chat theme picker offers black-and-emerald and navy-and-gold palettes', js.includes("id: 'obsidian'") && js.includes("id: 'royal'") && js.includes('Royal Gold'));
check('Live Chat themes include a preview and apply only to chat surfaces', js.includes('chat-theme-preview') && css.includes('html[data-chat-theme="obsidian"] .chat-agent-workspace') && css.includes('html[data-chat-theme="royal"] .chat-inbox'));
check('Live Chat theme preference is validated and persisted per signed-in agent', handlers.includes("b.chatTheme === undefined ? null : chatThemeById") && handlers.includes('chat_theme = coalesce($6, desk_prefs.chat_theme)') && handlers.includes('chatTheme, avatar:'));
check('Live Chat theme preference is returned on initialization and defaults safely', handlers.includes('usableChatTheme(pref?.chat_theme)') && themeRegistry.includes("export const usableChatTheme"));

check('the agent workspace refreshes the current visitor page during the existing Live Chat inbox refresh cycle', js.includes('function refreshChatVisitorPage(number)') && js.includes("api('get', { number: number, messageLimit: 1 })") && js.includes('refreshChatVisitorPage(current.ticket.number)'));
check('the visitor page context is labelled as current for chats and as submission context for other tickets', js.includes("chatConversationOpen?'Current page':'Page at submission'"));
check('the Classic Live Chat palette stays independent from whichever global desk theme the agent uses', css.includes('html[data-chat-theme="classic"] .chat-agent-workspace') && css.includes('--d-rail:#03363d'));
