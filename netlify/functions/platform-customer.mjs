// netlify/functions/platform-customer.mjs: one customer in detail for the platform owner, see src/handlers.js (platformCustomer)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { platformCustomer } from '../../src/handlers.js';
export default logged('platform-customer', async req => platformCustomer(req, context()));
export const config = { path: '/api/admin/customer' };
