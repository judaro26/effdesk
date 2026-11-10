// netlify/functions/api-v1.mjs: the REST API, see src/handlers.js (apiV1) and docs/API.md
import { context } from '../../src/context.js';
import { apiV1 } from '../../src/handlers.js';
export default async req => apiV1(req, context());
export const config = { path: '/api/v1/*' };
