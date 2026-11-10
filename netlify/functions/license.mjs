// netlify/functions/license.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { license } from '../../src/handlers.js';
export default logged('license', async req => license(req, context()));
export const config = { path: ['/api/license', '/api/admin/license'] };
