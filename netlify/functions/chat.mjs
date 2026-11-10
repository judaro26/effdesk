// netlify/functions/chat.mjs: the public live chat endpoints, see src/chat.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { chatApi } from '../../src/chat.js';
export default logged('chat', async req => chatApi(req, context()));
export const config = { path: '/api/chat/*' };
