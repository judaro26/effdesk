// Seed a dedicated, empty EffDesk staging database with disposable multi-tenant data.
// This script is intentionally guarded and idempotent. It never connects to DATABASE_URL.
import pg from 'pg';
import { explicitSsl } from '../src/db.js';
import { migrate } from './migrate.js';

const databaseUrl = process.env.STAGING_DATABASE_URL;
const workspaceCount = Number(process.env.STAGING_SEED_WORKSPACES || 10);
const ticketsPerWorkspace = Number(process.env.STAGING_SEED_TICKETS || 100);
const chatsPerWorkspace = Number(process.env.STAGING_SEED_CHATS || 20);
const agentsPerWorkspace = Number(process.env.STAGING_SEED_AGENTS || 3);

function validate() {
  if (!databaseUrl) throw new Error('STAGING_DATABASE_URL is required. DATABASE_URL is deliberately not supported.');
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('STAGING_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.toLowerCase().endsWith('.neon.tech') || !url.hostname.toLowerCase().includes('-pooler')) {
    throw new Error('Refusing to seed: use a pooled Neon connection string.');
  }
  if (!/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) throw new Error('Refusing to seed: database name must contain staging, stage, or test.');
  if (!Number.isInteger(workspaceCount) || workspaceCount < 2 || workspaceCount > 30) throw new Error('STAGING_SEED_WORKSPACES must be 2–30.');
  if (!Number.isInteger(ticketsPerWorkspace) || ticketsPerWorkspace < 10 || ticketsPerWorkspace > 2000) throw new Error('STAGING_SEED_TICKETS must be 10–2000.');
  if (!Number.isInteger(chatsPerWorkspace) || chatsPerWorkspace < 5 || chatsPerWorkspace > 500) throw new Error('STAGING_SEED_CHATS must be 5–500.');
  if (!Number.isInteger(agentsPerWorkspace) || agentsPerWorkspace < 2 || agentsPerWorkspace > 20) throw new Error('STAGING_SEED_AGENTS must be 2–20.');
  return { dbName, host: url.hostname };
}

const target = validate();
console.log(`Preparing schema on dedicated staging database ${target.dbName} (${target.host})...`);
await migrate(databaseUrl);

const pool = new pg.Pool({
  connectionString: explicitSsl(databaseUrl),
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: true }
});

const names = ['Alex Morgan', 'Jamie Chen', 'Taylor Rivera', 'Morgan Patel', 'Casey Brooks', 'Jordan Kim'];
const subjects = ['Unable to access my account', 'Question about billing', 'Need help updating profile', 'Service is running slowly', 'Integration setup assistance', 'Request for account review', 'Cannot reset my password', 'Feature availability question'];
const visitorNames = ['Sam Taylor', 'Riley Jordan', 'Avery Morgan', 'Quinn Parker', 'Drew Campbell', 'Skyler Reed'];
const now = Date.now();

try {
  const orgIds = [];
  for (let n = 1; n <= workspaceCount; n++) {
    const orgId = `stg_effdesk_org_${String(n).padStart(2, '0')}`;
    orgIds.push(orgId);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);

      const orgName = `EffDesk Staging Workspace ${String(n).padStart(2, '0')}`;
      const orgSlug = `effdesk-staging-${String(n).padStart(2, '0')}`;
      const seeded = await client.query('select metadata from "organization" where id=$1', [orgId]);
      if (seeded.rows[0]?.metadata?.includes('effdesk-staging-seed-v1')) {
        console.log(`Skipping ${orgId}: already seeded.`);
        await client.query('rollback');
        continue;
      }

      await client.query(
        'insert into "organization" (id,name,slug,"createdAt",metadata) values ($1,$2,$3,now(),$4) on conflict (id) do update set name=excluded.name, slug=excluded.slug, metadata=excluded.metadata',
        [orgId, orgName, orgSlug, 'effdesk-staging-seed-v1']
      );

      const agentIds = [];
      for (let a = 1; a <= agentsPerWorkspace; a++) {
        const agentId = `stg_agent_${String(n).padStart(2,'0')}_${String(a).padStart(2,'0')}`;
        agentIds.push(agentId);
        const fullName = names[(n + a - 2) % names.length];
        await client.query(
          'insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,$2,$3,true,now(),now()) on conflict (id) do nothing',
          [agentId, fullName, `${agentId}@example.invalid`]
        );
        await client.query(
          'insert into "member" (id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,$4,now()) on conflict (id) do nothing',
          [`stg_member_${String(n).padStart(2,'0')}_${String(a).padStart(2,'0')}`, orgId, agentId, a === 1 ? 'admin' : 'member']
        );
      }

      await client.query(
        'insert into chat_settings (org_id,enabled,title,greeting) values ($1,true,$2,$3) on conflict (org_id) do update set enabled=true',
        [orgId, `Chat with ${orgName}`, 'Hello! This is a synthetic staging conversation.']
      );

      await client.query(
        `insert into tickets (org_id,number,subject,status,priority,channel,requester_name,requester_email,assignee_id,tags,created_at,updated_at)
         select $1, g, $2 || ' #' || g,
           (array['open','pending','solved','closed'])[((g-1)%4)+1],
           (array['low','normal','high','urgent'])[((g-1)%4)+1],
           (array['web','email','api'])[((g-1)%3)+1],
           $3 || ' ' || g, 'requester-' || g || '@example.invalid',
           ($4::text[])[((g-1)%array_length($4::text[],1))+1], array['staging','synthetic'],
           now() - (g || ' hours')::interval, now() - ((g%24) || ' hours')::interval
         from generate_series(1,$5::int) g
         on conflict (org_id,number) do nothing`,
        [orgId, subjects[n % subjects.length], 'Test Requester', agentIds, ticketsPerWorkspace]
      );

      await client.query(
        `insert into ticket_messages (org_id,ticket_id,kind,author_id,author_name,body,created_at)
         select t.org_id,t.id,
           case when m.n%2=0 then 'agent' else 'requester' end,
           case when m.n%2=0 then t.assignee_id else null end,
           case when m.n%2=0 then 'Synthetic Agent' else t.requester_name end,
           'Synthetic staging message ' || m.n || ' for ticket ' || t.number,
           t.created_at + (m.n || ' minutes')::interval
         from tickets t cross join generate_series(1,4) m(n)
         where t.org_id=$1 and t.tags @> array['synthetic']
           and not exists (select 1 from ticket_messages x where x.org_id=t.org_id and x.ticket_id=t.id)`,
        [orgId]
      );

      await client.query(
        `insert into chat_conversations (org_id,subject,status,requester_name,requester_email,visitor_key,assignee_id,priority,page_url,page_title,referrer,user_agent,source,created_at,updated_at)
         select $1,'Synthetic visitor conversation #' || g,
           (array['open','pending','solved','closed'])[((g-1)%4)+1],
           $2 || ' ' || g,'visitor-' || g || '@example.invalid',
           'stg-visitor-' || $1 || '-' || g,
           case when g%3=0 then null else $3[((g-1)%array_length($3,1))+1] end,
           (array['normal','high','urgent'])[((g-1)%3)+1],
           'https://demo.example.invalid/pricing','Synthetic pricing page',
           'https://search.example.invalid/','Synthetic Browser / Staging',
           'widget', now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
         from generate_series(1,$4::int) g`,
        [orgId, 'Staging Visitor', agentIds, chatsPerWorkspace]
      );

      await client.query(
        `insert into chat_messages (org_id,conversation_id,kind,author_id,author_name,body,created_at)
         select c.org_id,c.id,
           case when m.n%2=0 then 'agent' else 'requester' end,
           case when m.n%2=0 then c.assignee_id else null end,
           case when m.n%2=0 then 'Synthetic Agent' else c.requester_name end,
           'Synthetic staging chat message ' || m.n,
           c.created_at + (m.n || ' minutes')::interval
         from chat_conversations c cross join generate_series(1,4) m(n)
         where c.org_id=$1 and c.visitor_key like 'stg-visitor-%'`,
        [orgId]
      );

      await client.query(
        `insert into chat_events (org_id,conversation_id,actor_name,kind,detail,created_at)
         select org_id,id,'Synthetic Visitor','visitor_started','Synthetic staging chat started',created_at
         from chat_conversations where org_id=$1 and visitor_key like 'stg-visitor-%'`,
        [orgId]
      );

      await client.query('commit');
      console.log(`Seeded ${orgId}: ${agentsPerWorkspace} agents, ${ticketsPerWorkspace} tickets, ${chatsPerWorkspace} chats.`);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw new Error(`Failed seeding ${orgId}: ${error.message}`);
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ database: target.dbName, workspaces: orgIds, agents_per_workspace: agentsPerWorkspace, tickets_per_workspace: ticketsPerWorkspace, chats_per_workspace: chatsPerWorkspace }, null, 2));
} finally {
  await pool.end();
}
