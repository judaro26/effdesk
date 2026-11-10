// netlify/functions/automations.mjs: every hour, runs each organization's timed rules (for example "solved for 7 days -> closed"), see src/triggers.js
import { context } from '../../src/context.js';
import { runTimed } from '../../src/triggers.js';
export default async () => { const { pool, mailer, env } = context(); const r = await runTimed(pool, mailer, env || process.env); console.log('timed rules ran:', r.ran); };
export const config = { schedule: '@hourly' };
