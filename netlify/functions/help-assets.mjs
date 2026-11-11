// netlify/functions/help-assets.mjs: pictures for help articles and PDF import, see src/handlers.js (helpAssets)
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { helpAssets } from '../../src/handlers.js';
export default logged('help-assets', async req => helpAssets(req, context()));
export const config = { path: ['/api/help-assets/image', '/api/help-assets/pdf'] };
