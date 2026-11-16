// scripts/test-chat-legacy-backfill.js: verifies both legacy backfills reconcile to one lossless conversation.
import fs from 'node:fs';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { withOrg } from '../src/db.js';

const { url } = await freshDb('chat-legacy-backfill');
await migrate(url);
const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: url });
const orgId = 'chat-backfill-org';
await pool.query('insert into "organization" (id,name,slug,"createdAt") values ($1,$2,$3,now())', [orgId,'Chat Backfill','chat-backfill']);
const ticket = await withOrg(pool, orgId, async c => {
  const t = (await c.query(`insert into tickets (org_id,number,subject,status,priority,channel,requester_name,requester_email,assignee_id,created_at,updated_at)
    values ($1,41,'Chat: Legacy visitor','open','high','chat','Visitor','visitor@example.com','agent-1',now()-interval '1 hour',now())
    returning id,created_at,updated_at`, [orgId])).rows[0];
  await c.query("insert into ticket_messages (org_id,ticket_id,kind,author_name,body,created_at) values ($1,$2,'requester','Visitor','I need help',now()-interval '1 hour'),($1,$2,'agent','Agent','I can help',now()-interval '30 minutes')", [orgId,t.id]);
  return t;
});

// Reproduce the two historical 074 migrations in their actual sort order.
const legacyBackfill = fs.readFileSync(new URL('../migrations/074_live_chat_legacy_backfill.sql', import.meta.url), 'utf8');
const sourceBackfill = fs.readFileSync(new URL('../migrations/074_chat_legacy_ticket_backfill.sql', import.meta.url), 'utf8');
const reconcile = fs.readFileSync(new URL('../migrations/075_reconcile_duplicate_chat_backfills.sql', import.meta.url), 'utf8');
await pool.query(legacyBackfill);
await pool.query(sourceBackfill);
await pool.query(reconcile);
await pool.query(reconcile);

const result = await withOrg(pool, orgId, async c => {
  const conversations = (await c.query('select * from chat_conversations where org_id=$1 and (legacy_ticket_id=$2 or source_ticket_id=$2)', [orgId,ticket.id])).rows;
  const conversation = conversations[0];
  const messages = (await c.query('select * from chat_messages where org_id=$1 and conversation_id=$2 order by created_at,id', [orgId,conversation?.id])).rows;
  const events = (await c.query("select * from chat_events where org_id=$1 and conversation_id=$2 and kind='legacy_import'", [orgId,conversation?.id])).rows;
  const legacy = (await c.query("select count(*)::int n from tickets where org_id=$1 and id=$2 and channel='chat'", [orgId,ticket.id])).rows[0].n;
  const total = (await c.query('select count(*)::int n from chat_conversations where org_id=$1 and (legacy_ticket_id=$2 or source_ticket_id=$2)', [orgId,ticket.id])).rows[0].n;
  return {conversation,messages,events,legacy,total};
});
check('both historical backfills reconcile to exactly one conversation', result.total === 1 && Number(result.conversation?.legacy_ticket_id) === Number(ticket.id) && Number(result.conversation?.source_ticket_id) === Number(ticket.id));
check('conversation metadata and assignment are preserved', result.conversation?.requester_email === 'visitor@example.com' && result.conversation?.assignee_id === 'agent-1' && result.conversation?.priority === 'high');
check('the full transcript is present once and preserves message order', result.messages.length === 2 && result.messages[0].body === 'I need help' && result.messages[1].body === 'I can help');
check('both bridge ids point to the original ticket messages', result.messages.every(m => Number(m.source_message_id) === Number(m.legacy_ticket_message_id)));
check('one import event remains and the legacy ticket is untouched', result.events.length === 1 && result.legacy === 1);
await pool.end();
done();
process.exit(0);
