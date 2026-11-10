// netlify/functions/auth.mjs: see src/handlers.js
import { context } from '../../src/context.js';
export default async req => context().auth.handler(req);
export const config = { path: '/api/auth/*' };
