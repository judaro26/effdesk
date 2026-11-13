// Authenticated real-user browser performance metrics.
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { performanceVitals } from '../../src/handlers.js';
export default logged('performance-vitals', async req => performanceVitals(req, context()));
export const config = { path: '/api/performance-vitals' };
