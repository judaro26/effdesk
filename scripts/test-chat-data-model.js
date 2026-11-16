// scripts/test-chat-data-model.js: verifies the independent Live Chat schema and tenant protections.
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';

const { url } = await freshDb('chat-data-model');
const ran = await migrate(url);
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: url });
await client.connect();
const tables = ['chat_conversations','chat_messages','chat_events'];
for (const table of tables) {
  const row = (await client.query('select c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.oid = $1::regclass', [table])).rows[0];
  check(table + ' has row-level security forced on', !!row?.relrowsecurity && !!row?.relforcerowsecurity);
  const policy = (await client.query('select 1 from pg_policies where tablename=$1 and policyname=$2', [table, table + '_tenant'])).rowCount;
  check(table + ' has an organization-scoped RLS policy', policy === 1);
}
const constraints = (await client.query(`
  select conrelid::regclass::text as table_name, confrelid::regclass::text as parent_table
  from pg_constraint
  where conname in ('chat_messages_org_id_conversation_id_fkey','chat_events_org_id_conversation_id_fkey')
`)).rows;
check('chat messages and events use tenant-composite conversation foreign keys',
  constraints.length === 2 && constraints.every(x => x.parent_table === 'chat_conversations'));
const indexes = (await client.query("select indexname from pg_indexes where schemaname='public' and tablename='chat_conversations'")).rows.map(x => x.indexname);
check('conversation queue, requester, visitor reuse and assignment indexes exist',
  ['chat_conversations_org_queue_idx','chat_conversations_org_requester_idx','chat_conversations_org_visitor_reuse_idx','chat_conversations_org_assignee_idx'].every(x => indexes.includes(x)));
check('migration 073 was applied exactly once', ran.includes('073_dedicated_live_chat_data_model.sql') &&
  (await client.query("select count(*)::int n from schema_migrations where name='073_dedicated_live_chat_data_model.sql'")).rows[0].n === 1);
await client.end();
done();
process.exit(0);
