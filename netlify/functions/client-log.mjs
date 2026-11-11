// netlify/functions/client-log.mjs: script errors reported by browsers, see src/handlers.js (clientLog)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { clientLog } from '../../src/handlers.js';
export default logged('client-log', async req => clientLog(req, context()));
export const config = { path: '/api/client-log' };
