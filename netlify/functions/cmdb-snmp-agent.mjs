// Customer-installed SNMPv3 pollers authenticate with a tenant-bound, revocable bearer token.
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { ingestSnmpDiscoveryAgent } from '../../src/cmdb-snmp.js';
export default logged('cmdb-snmp-agent', async req => ingestSnmpDiscoveryAgent(req, context()));
export const config = { path: '/api/cmdb-snmp-agent' };
