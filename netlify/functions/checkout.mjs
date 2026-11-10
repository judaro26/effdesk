// netlify/functions/checkout.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { checkout } from '../../src/handlers.js';
export default logged('checkout', async req => checkout(req, context()));
export const config = { path: '/api/billing/checkout' };
