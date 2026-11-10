// netlify/functions/auth.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
export default logged('auth', async req => context().auth.handler(req));
export const config = { path: '/api/auth/*' };
