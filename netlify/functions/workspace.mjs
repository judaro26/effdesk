// netlify/functions/workspace.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { workspace } from '../../src/handlers.js';
export default logged('workspace', async req => workspace(req, context()));
export const config = { path: '/api/workspace' };
