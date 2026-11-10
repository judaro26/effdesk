// netlify/functions/me.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { me } from '../../src/handlers.js';
export default async req => me(req, context());
export const config = { path: '/api/me' };
