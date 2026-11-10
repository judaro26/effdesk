// netlify/functions/platform.mjs: the platform owner's customer list, see src/handlers.js (platformList)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { platformList } from '../../src/handlers.js';
export default logged('platform', async req => platformList(req, context()));
export const config = { path: '/api/admin/customers' };
