// netlify/functions/integrations.mjs
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { projectIntegrations } from '../../src/project-integrations.js';
export default logged('integrations', async req => projectIntegrations(req, context()));
export const config = { path: '/api/integrations/*' };
