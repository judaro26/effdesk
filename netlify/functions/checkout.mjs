// netlify/functions/checkout.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { checkout } from '../../src/handlers.js';
export default async req => checkout(req, context());
export const config = { path: '/api/billing/checkout' };
