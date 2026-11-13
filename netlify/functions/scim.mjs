// netlify/functions/scim.mjs
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { scim } from '../../src/scim.js';
export default logged('scim', async req => scim(req, context()));
export const config = { path: '/api/scim/v2/*' };
