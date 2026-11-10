// netlify/functions/whatsapp-webhook.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { whatsappWebhook } from '../../src/handlers.js';
export default logged('whatsapp-webhook', async req => whatsappWebhook(req, context()));
export const config = { path: '/api/webhooks/whatsapp' };
