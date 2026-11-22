// Mixed visitor/agent Live Chat load test. Runs only against guarded synthetic staging data.
// Includes an unmeasured warm-up phase and independent measured rounds to reduce cold-start/cache bias.
// Visitor polls refresh last_visitor_seen_at (a deliberate presence heartbeat); no messages or tickets are created.
import { createHash } from 'node:crypto';
import { normalizeSqlForFingerprint, sanitizeSqlTemplate } from './staging-sql-diagnostics.js';
import { getPool, withOrg } from '../src/db.js';
import { pollChat, chatToken, agentInbox } from '../src/chat.js';

const rawUrl = process.env.STAGING_DATABASE_URL;
const orgIds = [...new Set(String(process.env.STAGING_ORG_IDS || '').split(',').map(x => x.trim()).filter(Boolean))];
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();
const profiles = { smoke: { concurrency: 5, rounds: 2 }, standard: { concurrency: 15, rounds: 3 }, stress: { concurrency: 30, rounds: 3 } };
const baseSettings = profiles[profile];
const concurrencyOverride = process.env.STAGING_BENCH_CONCURRENCY == null ? null : Number(process.env.STAGING_BENCH_CONCURRENCY);
const settings = baseSettings && {
  ...baseSettings,
  concurrency: concurrencyOverride == null ? baseSettings.concurrency : concurrencyOverride
};
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
  if (!settings || !Number.isInteger(settings.concurrency) || settings.concurrency < 1 || settings.concurrency > 30) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress; concurrency override must be an integer from 1 to 30.');
  if (orgIds.length<2 || orgIds.length>30) throw new Error('STAGING_ORG_IDS must contain 2–30 synthetic staging workspace IDs.');
  return { host, dbName };
}
const target=validateTarget(rawUrl);
if(process.argv.includes('--check')) { console.log('Mixed Live Chat benchmark staging target is safe.'); process.exit(0); }
// Use the same singleton pool factory and SQL instrumentation as deployed application requests.
const pool=getPool(rawUrl);
const connectWait=[], connectionLease=[], leaseStarted=new WeakMap(), querySamples=new Map(), telemetryWrites=[], connect=pool.connect.bind(pool);
function finishLease(client) {
  const started=leaseStarted.get(client);
  if(started===undefined)return;
  connectionLease.push(performance.now()-started);
  leaseStarted.delete(client);
}
// node-postgres emits acquire/release for both callback and promise connect() overloads.
pool.on('acquire',client=>leaseStarted.set(client,performance.now()));
pool.on('release',(error,client)=>finishLease(client));
function instrumentClient(client) {
  if(!client || client.__effdeskMixedQueryTiming)return;
  client.__effdeskMixedQueryTiming=true;
  const originalQuery=client.query.bind(client);
  client.query=(...queryArgs)=>{
    const input=queryArgs[0],sql=typeof input==='string'?input:input?.text||'';
    const telemetry=/performance_(?:minute|query_minute|vitals_minute)/i.test(sql);
    const fingerprint=telemetry?'':createHash('sha256').update(normalizeSqlForFingerprint(sql)).digest('hex').slice(0,12);
    const sqlTemplate=telemetry?'':sanitizeSqlTemplate(sql),started=performance.now();
    const record=error=>{
      const elapsed=performance.now()-started;
      if(telemetry){telemetryWrites.push(elapsed);return;}
      let entry=querySamples.get(fingerprint);
      if(!entry){entry={durations:[],errors:0,sql_template:sqlTemplate};querySamples.set(fingerprint,entry);}
      entry.durations.push(elapsed);
      if(error)entry.errors++;
    };
    const callbackIndex=queryArgs.findIndex(value=>typeof value==='function');
    if(callbackIndex>=0){
      const callback=queryArgs[callbackIndex];
      queryArgs[callbackIndex]=function(error,...values){record(error);return callback(error,...values);};
      return originalQuery(...queryArgs);
    }
    try{
      const result=originalQuery(...queryArgs);
      return result&&typeof result.then==='function'
        ?result.then(value=>{record(null);return value;},error=>{record(error);throw error;})
        :result;
    }catch(error){record(error);throw error;}
  };
}
// Preserve node-postgres' two connect() overloads. The callback overload returns
// immediately and supplies the client later; awaiting it produces undefined.
pool.connect=function(...args){
  const started=performance.now();
  if(typeof args[0]==='function'){
    const callback=args[0];
    args[0]=(error,client,release)=>{
      connectWait.push(performance.now()-started);
      if(!error)instrumentClient(client);
      const trackedRelease=typeof release==='function'?(...releaseArgs)=>{finishLease(client);return release(...releaseArgs)}:release;
      return callback(error,client,trackedRelease);
    };
    return connect(...args);
  }
  return connect(...args).then(client=>{
    connectWait.push(performance.now()-started);
    instrumentClient(client);
    return client;
  });
};
const maxSamples={total:0,waiting:0};
const syntheticEnv={EMAIL_TOKEN_SECRET:'effdesk-staging-mixed-chat-benchmark-only-secret-v1'};
const targets=[];
try {
  for (const orgId of orgIds) {
    const org=(await pool.query('select slug from "organization" where id=$1',[orgId])).rows[0];
    if(!org?.slug) throw new Error('Missing seeded staging workspace slug for '+orgId);
    const chat=await withOrg(pool,orgId,async c=>(await c.query("select chat_number from chat_conversations where org_id=$1 and visitor_key like 'stg-visitor-%' and status in ('open','pending','on_hold') and chat_number is not null order by id limit 1",[orgId])).rows[0]||null);
    if(!chat?.chat_number) throw new Error('No active synthetic visitor conversation found for '+orgId+'; rerun the staging seeder.');
    targets.push({orgId,slug:org.slug,number:Number(chat.chat_number),token:chatToken(syntheticEnv,orgId,chat.chat_number)});
  }

  const scenarios=[
    {name:'visitor poll',run:t=>pollChat(pool,syntheticEnv,t.slug,t.number,t.token,0)},
    {name:'agent inbox',run:t=>agentInbox(pool,t.orgId,{view:'all',limit:50})}
  ];
  function buildTasks(rounds) {
    const tasks=[];
    for(let r=0;r<rounds;r++) for(const target of targets) {
      for(let n=0;n<3;n++) tasks.push({scenario:scenarios[0],target});
      tasks.push({scenario:scenarios[1],target});
    }
    return tasks;
  }
  async function executeTasks(tasks, concurrency, phase) {
    const samples=Object.fromEntries(scenarios.map(s=>[s.name,[]]));
    const failures=Object.fromEntries(scenarios.map(s=>[s.name,0]));
    let cursor=0;
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(true) {
        const i=cursor++; if(i>=tasks.length)return;
        const task=tasks[i],at=performance.now();
        try {
          const result=await task.scenario.run(task.target);
          if(result?.ok===false) throw new Error(result.error||'scenario returned an unsuccessful result');
          samples[task.scenario.name].push(performance.now()-at);
        } catch(error) {
          failures[task.scenario.name]++;
          console.error(JSON.stringify({phase,scenario:task.scenario.name,workspace:task.target.orgId,error:String(error?.message||error).slice(0,240)}));
        }
      }
    }));
    return {samples,failures};
  }
  function summarize(samples,failures) {
    return scenarios.map(s=>({scenario:s.name,requests:samples[s.name].length+failures[s.name],failures:failures[s.name],...sortedStats(samples[s.name])}));
  }

  const warmupTasks=buildTasks(1);
  const warmupStarted=performance.now();
  const warmup=await executeTasks(warmupTasks,settings.concurrency,'warmup');
  const warmupElapsed=performance.now()-warmupStarted;
  const warmupFailures=Object.values(warmup.failures).reduce((a,b)=>a+b,0);

  connectWait.splice(0);
  connectionLease.splice(0);
  querySamples.clear();
  telemetryWrites.splice(0);
  maxSamples.total=0; maxSamples.waiting=0;
  const measuredTasks=buildTasks(settings.rounds);
  const measuredRounds=[];
  const measuredResults=[];
  const sampler=setInterval(()=>{maxSamples.total=Math.max(maxSamples.total,pool.totalCount);maxSamples.waiting=Math.max(maxSamples.waiting,pool.waitingCount);},5);
  const startAt=Number(process.env.STAGING_BENCH_START_AT_MS||0);
  if(startAt>Date.now()) await new Promise(resolve=>setTimeout(resolve,startAt-Date.now()));
  const started=performance.now();
  try {
    for(let index=0;index<settings.rounds;index++) {
      const roundTasks=measuredTasks.slice(index*targets.length*4,(index+1)*targets.length*4);
      const roundStarted=performance.now();
      const result=await executeTasks(roundTasks,settings.concurrency,'measurement');
      measuredResults.push(result);
      const elapsed=performance.now()-roundStarted;
      measuredRounds.push({
        round:index+1,
        elapsed_ms:round(elapsed),
        requests_per_second:round(roundTasks.length/Math.max(elapsed,1)*1000),
        scenarios:summarize(result.samples,result.failures)
      });
    }
  } finally { clearInterval(sampler); }
  const elapsed=performance.now()-started;
  const aggregateSamples=Object.fromEntries(scenarios.map(s=>[s.name,measuredResults.flatMap(r=>r.samples[s.name])]));
  const aggregateFailures=Object.fromEntries(scenarios.map(s=>[s.name,measuredResults.reduce((sum,r)=>sum+r.failures[s.name],0)]));
  const totalRequests=measuredTasks.length;
  const totalFailures=Object.values(aggregateFailures).reduce((a,b)=>a+b,0);
  const aggregateScenarios=summarize(aggregateSamples,aggregateFailures);
  const queryDiagnostics=[...querySamples.entries()].map(([fingerprint,entry])=>{
    const values=entry.durations.sort((a,b)=>a-b);
    return{fingerprint,sql_template:entry.sql_template,calls:values.length,errors:entry.errors,
      total_ms:round(values.reduce((sum,value)=>sum+value,0)),
      p50_ms:round(percentile(values,.5)),p95_ms:round(percentile(values,.95)),max_ms:round(values.at(-1))};
  }).sort((a,b)=>b.total_ms-a.total_ms).slice(0,12);
  console.log(JSON.stringify({
    target:{host:target.host,database:target.dbName},
    workload:'mixed visitor polls and agent inbox refreshes; visitor polls update last_visitor_seen_at at most once per 15 seconds',
    profile,workspaces:targets.length,concurrency:settings.concurrency,
    warmup:{requests:warmupTasks.length,elapsed_ms:round(warmupElapsed),failures:warmupFailures},
    measured:{rounds:settings.rounds,requests:totalRequests,elapsed_ms:round(elapsed),requests_per_second:round(totalRequests/Math.max(elapsed,1)*1000),failures:totalFailures},
    pool:{max:pool.options.max,max_total_sampled:maxSamples.total,max_waiting_sampled:maxSamples.waiting,connection_acquire_ms:sortedStats(connectWait),connection_lease_ms:sortedStats(connectionLease)},
    scenarios:aggregateScenarios,
    rounds:measuredRounds,
    performance_sql_telemetry:{sample_rate:Number(process.env.PERFORMANCE_SQL_SAMPLE_RATE??0.03),writes:telemetryWrites.length,...sortedStats(telemetryWrites)},
    top_query_fingerprints:queryDiagnostics
  },null,2));
  if(warmupFailures||totalFailures)process.exitCode=1;
} finally { await pool.end(); }
