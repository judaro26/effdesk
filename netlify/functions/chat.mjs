// netlify/functions/chat.mjs: the public live chat endpoints, see src/chat.js
import { context } from '../../src/context.js';
import { chatApi } from '../../src/chat.js';
export default async req => chatApi(req, context());
export const config = { path: '/api/chat/*' };
