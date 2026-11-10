// netlify/functions/me.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { me } from '../../src/handlers.js';
export default logged('me', async req => me(req, context()));
export const config = { path: '/api/me' };
