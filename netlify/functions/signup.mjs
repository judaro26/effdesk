// netlify/functions/signup.mjs: see src/handlers.js
import { context } from '../../src/context.js';
import { signup } from '../../src/handlers.js';
export default async req => signup(req, context());
export const config = { path: '/api/signup' };
