// netlify/functions/workspace-check.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { workspaceCheck } from '../../src/handlers.js';
export default async req => workspaceCheck(req, context());
export const config = { path: '/api/workspace-check' };
