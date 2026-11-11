// netlify/functions/health.mjs: is the service up? (the status page and any uptime monitor call this), see src/handlers.js (health)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { health } from '../../src/handlers.js';
export default logged('health', async req => health(req, context()));
export const config = { path: '/api/health' };
