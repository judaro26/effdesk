// netlify/functions/workspace-check.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { workspaceCheck } from '../../src/handlers.js';
export default logged('workspace-check', async req => workspaceCheck(req, context()));
export const config = { path: '/api/workspace-check' };
