// netlify/functions/paddle-webhook.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { paddleWebhook } from '../../src/handlers.js';
export default async req => paddleWebhook(req, context());
export const config = { path: '/api/webhooks/paddle' };
