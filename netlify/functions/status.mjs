// netlify/functions/status.mjs: the public status page, its JSON and its feed, see src/handlers.js (statusPublic)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { statusPublic } from '../../src/handlers.js';
export default logged('status', async req => statusPublic(req, context()));
export const config = { path: ['/status', '/status/*', '/api/status'] };
