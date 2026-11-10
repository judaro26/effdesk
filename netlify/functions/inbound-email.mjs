// netlify/functions/inbound-email.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { inboundEmail } from '../../src/handlers.js';
export default logged('inbound-email', async req => inboundEmail(req, context()));
export const config = { path: '/api/webhooks/email' };
