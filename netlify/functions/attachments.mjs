// netlify/functions/attachments.mjs: upload (POST /api/attachments) and download (GET /api/attachments/<id>?org=…), see src/handlers.js
import { logged, captureConsole } from '../../src/log.js';
captureConsole();
import { context } from '../../src/context.js';
import { attachmentUpload, attachmentDownload } from '../../src/handlers.js';
export default logged('attachments', async req => (req.method === 'GET' ? attachmentDownload(req, context()) : attachmentUpload(req, context())));
export const config = { path: ['/api/attachments', '/api/attachments/*'] };
