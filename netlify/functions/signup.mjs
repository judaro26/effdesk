// netlify/functions/signup.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { signup } from '../../src/handlers.js';
export default logged('signup', async req => signup(req, context()));
export const config = { path: '/api/signup' };
