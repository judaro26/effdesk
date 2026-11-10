// netlify/functions/import.mjs: see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { importData } from '../../src/handlers.js';
export default logged('import', async req => importData(req, context()));
export const config = { path: '/api/import' };
