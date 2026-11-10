// netlify/functions/tickets.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { tickets } from '../../src/handlers.js';
export default logged('tickets', async req => tickets(req, context()));
export const config = { path: '/api/tickets' };
