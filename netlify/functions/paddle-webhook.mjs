// netlify/functions/paddle-webhook.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { paddleWebhook } from '../../src/handlers.js';
export default logged('paddle-webhook', async req => paddleWebhook(req, context()));
export const config = { path: '/api/webhooks/paddle' };
