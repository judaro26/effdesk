// netlify/functions/inbound-email.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { inboundEmail } from '../../src/handlers.js';
export default async req => inboundEmail(req, context());
export const config = { path: '/api/webhooks/email' };
