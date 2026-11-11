// netlify/functions/admin-do.mjs: the platform owner's console actions, see src/handlers.js (adminDo) and src/admin-actions.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { adminDo } from '../../src/handlers.js';
export default logged('admin-do', async req => adminDo(req, context()));
export const config = { path: '/api/admin/do' };
