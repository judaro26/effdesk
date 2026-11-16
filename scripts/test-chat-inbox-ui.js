// Regression expectations reflect the current accessible Live Chat inbox labels.
import fs from 'node:fs';
import { check, done } from './lib/check.js';

const js = fs.readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
const widget = fs.readFileSync(new URL('../public/js/chat.js', import.meta.url), 'utf8');
const embedWidget = fs.readFileSync(new URL('../public/widget.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/desk.css', import.meta.url), 'utf8');
const handlers = fs.readFileSync(new URL('../src/handlers.js', import.meta.url), 'utf8');
const themeRegistry = fs.readFileSync(new URL('../src/themes.js', import.meta.url), 'utf8');
const chatPage = fs.readFileSync(new URL('../public/chat.html', import.meta.url), 'utf8');
const deskPage = fs.readFileSync(new URL('../public/desk.html', import.meta.url), 'utf8');

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


check('the chat inbox loads a bounded server-side page instead of all conversations', js.includes("api('chat-inbox', { limit: chatInboxLimit, cursorMode: false, offset: chatInboxPageIndex * chatInboxLimit"));
check('background Live Chat reply alerts use a cursor feed instead of repeatedly fetching the first 100 tickets', js.includes("api('chat-reply-alerts', { after: chatReplyCursor || '0' })") && js.includes("api('chat-reply-alerts', { initialize: true })"));
check('the chat inbox exposes customer search and queue filters', js.includes('Search live chats by customer, email, subject or ticket number') && js.includes('Search customers, email or conversation #') && js.includes("value: 'needs-reply'") && js.includes("value: 'mine'"));
check('the chat inbox offers previous and next page navigation', js.includes('chatInboxPageIndex = Math.max(0, chatInboxPageIndex - 1)'));
check('queue summary cards use server-side totals rather than the current page length', js.includes('String(chatInboxCounts.total)') && js.includes('String(chatInboxCounts.waiting)'));
check('queue controls remain usable on mobile', css.includes('.chat-inbox-pagination') && css.includes('.chat-inbox-search') && css.includes('@media(max-width:560px)'));


check('agents can change their personal Live Chat palette directly from the active conversation header', js.includes('chat-theme-quick-select') && js.includes("api('prefs-save', { chatTheme: next })") && js.includes('CHAT_THEMES.forEach'));
check('the multi-chat workspace keeps visitor context visible beside the live conversation', css.includes('.chat-agent-workspace>.chat-agent-conversation{display:grid') && css.includes('.chat-agent-workspace .chat-agent-conversation>.info{display:block!important'));
check('the Live Chat workspace adapts its conversation and visitor panels for tablet and mobile widths', css.includes('@media(max-width:900px)') && css.includes('@media(max-width:760px)'));


done();

check('accepted Live Chat conversations stay in the dedicated Live Chat navigation context', js.includes("chatConversationOpen = r.body.ticket.channel === 'chat'") && js.includes("(chatInboxOpen || chatConversationOpen) ? 'chat'"));
check('agent chat conversations use a dedicated layout rather than the standard ticket sidebars', js.includes("'chat-agent-conversation'") && css.includes('.chat-agent-conversation>.props') && css.includes('.chat-agent-conversation>.info'));
check('the dedicated chat view identifies the visitor and offers a direct return to all conversations', js.includes('LIVE CHAT · CUSTOMER CONVERSATION') && js.includes("'data-back-chat-inbox': '1'") && js.includes('All conversations'));
check('the dedicated agent chat layout is responsive and uses workspace theme tokens', css.includes('.chat-agent-conversation') && css.includes('var(--d-panel)') && css.includes('@media(max-width:760px)'));
check('Live Chat visitor overview shows device, operating system, browser and page context', js.includes('chat-visitor-context-grid') && js.includes('visitorDevice') && js.includes('visitorOs') && js.includes('visitorBrowser') && js.includes('visitorPage'));
check('visitor overview never guesses a location when coordinates are absent', js.includes('No approximate location data supplied') && js.includes('No location to plot yet'));
check('visitor maps only render from finite, bounded coordinates supplied by the visitor context source', js.includes('hasVisitorCoords') && js.includes('Math.abs(visitorLat) <= 90') && js.includes('Math.abs(visitorLon) <= 180') && js.includes('openstreetmap.org/export/embed.html'));
check('visitor location maps include a privacy-conscious external map link', js.includes('referrerpolicy:\'no-referrer\'') && js.includes('Open larger map'));
check('visitor identity, device, browser, map and current page are grouped in a single vertical overview', js.includes('chat-visitor-overview') && js.includes('chat-visitor-context-stack') && js.includes('chat-visitor-map') && js.includes('chat-visitor-page'));
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

check('supervisors get a dedicated workspace navigation entry gated by the server-provided permission', js.includes("data-chat-supervision") && js.includes("canSuperviseChat = b.canSuperviseChat === true") && js.includes("item('supervisor'"));
check('the supervisor workspace shows active team conversations and a read-only transcript', js.includes("api('chat-supervision-inbox')") && js.includes("api('chat-monitor'") && js.includes('READ-ONLY SUPERVISION'));
check('supervisors can send private coaching notes and explicitly take over a conversation', js.includes("api('chat-copilot'") && js.includes("api('chat-takeover'") && js.includes('Take over chat'));
check('the supervisor workspace is responsive on tablets and phones', css.includes('.chat-supervisor-layout') && css.includes('@media(max-width:850px){.chat-supervisor-layout'));

check('visitor overview context tiles stack vertically instead of competing side by side', css.includes('.chat-visitor-context-stack{display:grid;grid-template-columns:minmax(0,1fr)}'));
check('Live Chat surfaces use theme-aware gradients, elevated cards and polished message bubbles', css.includes('Premium Live Chat presentation') && css.includes('linear-gradient(145deg,var(--d-out)') && css.includes('.chat-visitor-identity'));
check('each personal Live Chat palette has a distinct workspace background and message treatment', css.includes('html[data-chat-theme="obsidian"] .chat-agent-conversation .msg.out') && css.includes('html[data-chat-theme="royal"] .chat-agent-conversation .msg.out') && css.includes('html[data-chat-theme="ocean"] .chat-agent-conversation .msg.out') && css.includes('html[data-chat-theme="forest"] .chat-agent-conversation .msg.out') && css.includes('html[data-chat-theme="champagne"] .chat-agent-conversation .msg.out'));

check('Live Chat opens on an operations landing page with active conversation cards and an online agent roster', js.includes('function loadChatLanding()') && js.includes('function chatLandingPane()') && js.includes("item('chat', 'Live Chat', 'data-chat-inbox', loadChatLanding)") && js.includes('Current conversations') && js.includes('Agents online'));
check('joining the Live Chat queue enables availability and opens the chat grid', js.includes('function joinChatQueue()') && js.includes("api('chat-availability-set', { available: true })") && js.includes('return loadChatInbox()'));
check('the operations landing page refreshes its conversation grid and agent roster every 15 seconds', js.includes('function fetchChatLanding(showLoading)') && js.includes('chatLandingTimer = root.setTimeout(function () { fetchChatLanding(false); }, 15000)'));
check('visitor-ended conversations remain visible for agent review and are clearly labelled', js.includes('visitor_ended') && js.includes('Visitor ended this conversation') && css.includes('.chat-inbox-card.is-ended'));
check('ended chat transcripts are visually muted and the reply composer is disabled', js.includes("class:'chat-agent-conversation'+(t.visitor_ended || t.status==='closed'?' is-ended':'')") && css.includes('.chat-agent-conversation.is-ended .thread') && css.includes('.chat-agent-conversation.is-ended .compose{display:none}'));
check('the agent sees a read-only ended-chat notice with a follow-up ticket action available', js.includes('This conversation has ended. The transcript is read-only') && js.includes('Create ticket from chat'));
check('workspace settings expose a server-enforced visitor restart cooldown with a 15-second default', js.includes('restartCooldownSeconds: Number(crc.value)') && js.includes('restart_cooldown_seconds === undefined ? 15') && js.includes('Wait after a visitor ends a chat'));
check('the Live Chat landing dashboard uses responsive conversation-grid and roster styles', css.includes('.chat-landing-grid') && css.includes('.chat-landing-roster') && css.includes('@media(max-width:760px){.chat-landing-hero'));

check('visitors explicitly opt in before sharing approximate location from their browser', widget.includes('Share approximate location') && widget.includes('navigator.geolocation.getCurrentPosition') && widget.includes('latitude: position.coords.latitude'));
check('the server stores only rounded coordinates and the overview labels them as shared location', fs.readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8').includes('Math.round(latitude * 100) / 100') && js.includes('Approximate shared location') && css.includes('openstreetmap.org/export/embed.html'));

check('ticket detail returns opt-in visitor coordinates to the visitor overview', fs.readFileSync(new URL('../src/tickets.js', import.meta.url), 'utf8').includes('user_agent,latitude,longitude,submitted_at'));

check('the active visitor overview redraws when new location coordinates arrive', js.includes('var locationChanged = priorProvenance.latitude !== nextProvenance.latitude') && js.includes('if (locationChanged) { draw(); return; }'));

check('the embedded chat iframe permits browser geolocation only for the visitor-initiated sharing flow', embedWidget.includes("frame.setAttribute('allow', 'geolocation')") && widget.includes('Share approximate location'));

check('an already-open agent conversation picks up visitor-ended status on its 15-second refresh', js.includes('var latestChat = chatWorkspaceRows.filter') && js.includes('current.ticket.visitor_ended = true') && js.includes('The visitor ended this conversation.'));

const chatRuntime = fs.readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8');
const routing = fs.readFileSync(new URL('../src/routing.js', import.meta.url), 'utf8');
check('visitor chats persist independently and the default flow does not create a ticket', chatRuntime.includes('insert into chat_conversations') && !chatRuntime.includes('createTicket(pool, x.org.id, null'));
check('the agent UI opens dedicated chat detail and reply actions rather than ticket actions', js.includes("api(isChat ? 'chat-get' : 'get'") && js.includes("? 'chat-reply'"));
check('Live Chat claim, transfer, supervision and takeover operate on conversation rows', routing.includes('chatForNumber(c,orgId,number,true)') && routing.includes('update chat_conversations set assignee_id'));
check('automatic ticket conversion is exposed as an explicit admin setting and defaults off', js.includes('autoConvertToTicket: autoConvert.checked') && chatRuntime.includes('auto_convert_to_ticket: false'));
check('chat conversation numbers are separate from support ticket numbers', chatRuntime.includes('cc.chat_number=$2') && fs.readFileSync(new URL('../migrations/078_live_chat_runtime_cutover.sql', import.meta.url), 'utf8').includes('chat_conversation_number_seq'));

check('agent typing presence and visitor widget status are independent of ticket presence', js.includes("api(chatConversationOpen ? 'chat-presence' : 'presence'") && chatRuntime.includes('from chat_presence where org_id=$1'));
check('chat conversations retain a dedicated deep link and use chat-scoped attachments rather than ticket attachment links', js.includes("addr(n, isChat === true)") && js.includes("if (chatNo > 0) return open(chatNo, true)") && js.includes("chatConversationOpen ? '&chat=' + t.number : '&ticket=' + t.number") && js.includes('picker(t, permanentlyClosed') && fs.readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8').includes('chat_message_id'));

check('the Live Chat landing page opens the agent workspace directly instead of another inbox landing page', js.includes('openNextLiveChat') && js.includes('Open my next chat'));
check('visitor and agent typing indicators are connected end-to-end and use refreshed client scripts',widget.includes("api('typing?org=")&&widget.includes('r.body.agentTyping')&&js.includes("api(chatConversationOpen ? 'chat-presence' : 'presence'")&&js.includes('is typing…')&&chatPage.includes('chat.js?v=live-chat-attachments-typing-20261117')&&deskPage.includes('desk.js?v=live-chat-attachments-typing-20261117'));
check('visitor chat attachments upload before sending and render secure token-scoped downloads',widget.includes('/api/chat/upload?org=')&&widget.includes('attachmentIds: ids')&&widget.includes('/api/chat/file?org=')&&js.includes("chatConversationOpen ? '&chat=' + t.number : '&ticket=' + t.number"));



check('the agent chat workspace responds to its actual available width rather than only the browser viewport', css.includes('container-name:desk-content') && css.includes('container-type:inline-size') && css.includes('@container desk-content (max-width:1160px)') && css.includes('container-name:chat-agent'));
check('the agent workspace stacks visitor context below the conversation when its content area narrows', css.includes('@container chat-agent (max-width:1160px)') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
check('the multi-chat switcher becomes a horizontally scrollable strip in a narrow workspace', css.includes('@container chat-agent (max-width:820px)') && css.includes('scroll-snap-type:x proximity') && css.includes('.chat-workspace-item{flex:0 0 min(250px,78%)'));
check('narrow chat headers, message content and composer controls wrap without overflowing', css.includes('@container chat-agent (max-width:560px)') && css.includes('overflow-wrap:anywhere') && css.includes('compose .bar{display:flex;flex-wrap:wrap'));
