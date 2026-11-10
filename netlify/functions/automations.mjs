// netlify/functions/automations.mjs: every hour, runs each organization's timed rules (for example "solved for 7 days -> closed"), see src/triggers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { runTimed } from '../../src/triggers.js';
import { runSlaAlerts } from '../../src/sla-alerts.js';
import { runUsage, runUsageAlerts } from '../../src/support.js';
export default logged('automations', async () => { const { pool, mailer, env } = context(); const r = await runTimed(pool, mailer, env || process.env); console.log('timed rules ran:', r.ran); const a = await runSlaAlerts(pool, mailer, env || process.env); console.log('sla alerts sent:', a.sent); const u = await runUsage(pool); console.log('usage rows:', u.rows); const ua = await runUsageAlerts(pool, mailer, env || process.env); console.log('usage alerts sent:', ua.sent); });
export const config = { schedule: '@hourly' };
