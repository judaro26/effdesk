// netlify/functions/import.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { importData } from '../../src/handlers.js';
export default async req => importData(req, context());
export const config = { path: '/api/import' };
