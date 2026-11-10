// netlify/functions/license.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { license } from '../../src/handlers.js';
export default async req => license(req, context());
export const config = { path: '/api/admin/license' };
