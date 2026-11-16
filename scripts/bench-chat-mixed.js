// Mixed visitor/agent Live Chat load test. Runs only against guarded synthetic staging data.
// Visitor polls refresh last_visitor_seen_at (a deliberate presence heartbeat); no messages or tickets are created.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { normalizeSqlForFingerprint, sanitizeSqlTemplate } from './staging-sql-diagnostics.js';
import { explicitSsl, withOrg } from '../src/db.js';
import { pollChat, chatToken, agentInbox } from '../src/chat.js';

const rawUrl = process.env.STAGING_DATABASE_URL;
const orgIds = [...new Set(String(process.env.STAGING_ORG_IDS || '').split(',').map(x => x.trim()).filter(Boolean))];
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();
const profiles = { smoke: { concurrency: 5, rounds: 2 }, standard: { concurrency: 15, rounds: 3 }, stress: { concurrency: 30, rounds: 3 } };
const settings = profiles[profile];
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const round = n => Number(n.toFixed(1));
const sortedStats = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? { samples: sorted.length, p50_ms: round(percentile(sorted,.5)), p95_ms: round(percentile(sorted,.95)), p99_ms: round(percentile(sorted,.99)), max_ms: round(sorted.at(-1)) } : { samples: 0, p50_ms: null, p95_ms: null, p99_ms: null, max_ms: null };
};

function validateTarget(value) {
  if (!value) throw new Error('STAGING_DATABASE_URL is required.');
  let url; try { url = new URL(value); } catch { throw new Error('STAGING_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:','postgresql:'].includes(url.protocol)) throw new Error('STAGING_DATABASE_URL must use postgres:// or postgresql://.');
  const host=url.hostname.toLowerCase(), dbName=decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  if (!host.endsWith('.neon.tech') || !host.includes('-pooler')) throw new Error('Refusing to run: use the dedicated Neon pooled staging connection string.');
  if (!/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) throw new Error('Refusing to run: database name must contain staging, stage, or test.');
  if (!settings) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress.');
  if (orgIds.length<2 || orgIds.length>30) throw new Error('STAGING_ORG_IDS must contain 2–30 synthetic staging workspace IDs.');
  return { host, dbName };
}
const target=validateTarget(rawUrl);
if(process.argv.includes('--check')) { console.log('Mixed Live Chat benchmark staging target is safe.'); process.exit(0); }
const pool=new pg.Pool({connectionString:explicitSsl(rawUrl),max:10,idleTimeoutMillis:10000,ssl:{rejectUnauthorized:true}});
const connectWait=[], querySamples=new Map(), connect=pool.connect.bind(pool);
pool.connect=async(...args)=>{
  const start=performance.now(),client=await connect(...args);
  connectWait.push(performance.now()-start);
  if(!client.__effdeskMixedQueryTiming){
    client.__effdeskMixedQueryTiming=true;
    const originalQuery=client.query.bind(client);
    client.query=(...queryArgs)=>{
      if(queryArgs.some(value=>typeof value==='function'))return originalQuery(...queryArgs);
      const input=queryArgs[0],sql=typeof input==='string'?input:input?.text||'';
      const fingerprint=createHash('sha256').update(normalizeSqlForFingerprint(sql)).digest('hex').slice(0,12);
      const sqlTemplate=sanitizeSqlTemplate(sql),started=performance.now();
      const record=error=>{
        let entry=querySamples.get(fingerprint);
        if(!entry){entry={durations:[],errors:0,sql_template:sqlTemplate};querySamples.set(fingerprint,entry);}
        entry.durations.push(performance.now()-started);
        if(error)entry.errors++;
      };
      try{
        const result=originalQuery(...queryArgs);
        return result&&typeof result.then==='function'
          ?result.then(value=>{record(null);return value;},error=>{record(error);throw error;})
          :result;
      }catch(error){record(error);throw error;}
    };
  }
  return client;
};
const maxSamples={total:0,waiting:0};
const syntheticEnv={EMAIL_TOKEN_SECRET:'effdesk-staging-mixed-chat-benchmark-only-secret-v1'};
const targets=[];
try {
  // Resolve one seeded, active visitor conversation per tenant under that tenant's RLS context.
  for (const orgId of orgIds) {
    const org=(await pool.query('select slug from "organization" where id=$1',[orgId])).rows[0];
    if(!org?.slug) throw new Error('Missing seeded staging workspace slug for '+orgId);
    const chat=await withOrg(pool,orgId,async c=>(await c.query("select chat_number from chat_conversations where org_id=$1 and visitor_key like 'stg-visitor-%' and status in ('open','pending','on_hold') order by id limit 1",[orgId])).rows[0]||null);
    if(!chat?.chat_number) throw new Error('No active synthetic visitor conversation found for '+orgId+'; rerun the staging seeder.');
    targets.push({orgId,slug:org.slug,number:Number(chat.chat_number),token:chatToken(syntheticEnv,orgId,chat.chat_number)});
  }

  const scenarios=[
    {name:'visitor poll',run:t=>pollChat(pool,syntheticEnv,t.slug,t.number,t.token,0)},
    {name:'agent inbox',run:t=>agentInbox(pool,t.orgId,{view:'all',limit:50})}
  ];
  const samples=Object.fromEntries(scenarios.map(s=>[s.name,[]]));
  const failures=Object.fromEntries(scenarios.map(s=>[s.name,0]));
  const tasks=[];
  for(let r=0;r<settings.rounds;r++) for(const target of targets) {
    // Approximate several active visitor windows for every agent inbox refresh.
    for(let n=0;n<3;n++) tasks.push({scenario:scenarios[0],target});
    tasks.push({scenario:scenarios[1],target});
  }
  let cursor=0;
  const sampler=setInterval(()=>{maxSamples.total=Math.max(maxSamples.total,pool.totalCount);maxSamples.waiting=Math.max(maxSamples.waiting,pool.waitingCount);},5);
  const started=performance.now();
  try {
    await Promise.all(Array.from({length:settings.concurrency},async()=>{
      while(true){
        const i=cursor++;if(i>=tasks.length)return;
        const task=tasks[i],at=performance.now();
        try{
          const result=await task.scenario.run(task.target);
          if(result?.ok===false) throw new Error(result.error||'scenario returned an unsuccessful result');
          samples[task.scenario.name].push(performance.now()-at);
        }catch(error){
          failures[task.scenario.name]++;
          console.error(JSON.stringify({scenario:task.scenario.name,workspace:task.target.orgId,error:String(error?.message||error).slice(0,240)}));
        }
      }
    }));
  } finally { clearInterval(sampler); }
  const elapsed=performance.now()-started;
  const summary=scenarios.map(s=>({scenario:s.name,requests:samples[s.name].length+failures[s.name],failures:failures[s.name],...sortedStats(samples[s.name])}));
  const queryDiagnostics=[...querySamples.entries()].map(([fingerprint,entry])=>{
    const values=entry.durations.sort((a,b)=>a-b);
    return{fingerprint,sql_template:entry.sql_template,calls:values.length,errors:entry.errors,
      total_ms:round(values.reduce((sum,value)=>sum+value,0)),
      p50_ms:round(percentile(values,.5)),p95_ms:round(percentile(values,.95)),max_ms:round(values.at(-1))};
  }).sort((a,b)=>b.total_ms-a.total_ms).slice(0,12);
  console.log(JSON.stringify({
    target:{host:target.host,database:target.dbName},
    workload:'mixed visitor polls and agent inbox refreshes; visitor polls update last_visitor_seen_at at most once per 15 seconds',
    profile,workspaces:targets.length,concurrency:settings.concurrency,elapsed_ms:round(elapsed),
    requests_per_second:round(tasks.length/Math.max(elapsed,1)*1000),
    pool:{max:pool.options.max,max_total_sampled:maxSamples.total,max_waiting_sampled:maxSamples.waiting,connection_acquire_ms:sortedStats(connectWait)},
    scenarios:summary,
    top_query_fingerprints:queryDiagnostics
  },null,2));
  if(summary.some(s=>s.failures))process.exitCode=1;
} finally { await pool.end(); }
