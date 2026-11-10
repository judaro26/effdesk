// netlify/functions/workspace.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { workspace } from '../../src/handlers.js';
export default async req => workspace(req, context());
export const config = { path: '/api/workspace' };
