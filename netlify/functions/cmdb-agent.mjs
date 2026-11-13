// Customer-installed discovery agents authenticate with a tenant-bound, revocable bearer token.
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { ingestDiscoveryAgent } from '../../src/cmdb-agent.js';
export default logged('cmdb-agent', async req => ingestDiscoveryAgent(req, context()));
export const config = { path: '/api/cmdb-agent' };
