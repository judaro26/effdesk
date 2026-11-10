// netlify/functions/ticket-export.mjs: a ticket thread to print or as .eml, see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { ticketExport } from '../../src/handlers.js';
export default logged('ticket-export', async req => ticketExport(req, context()));
export const config = { path: '/api/ticket-export' };
