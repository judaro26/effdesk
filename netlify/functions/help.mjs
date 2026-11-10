// netlify/functions/help.mjs: the public help center and customer portal, see src/handlers.js
import { context } from '../../src/context.js';
import { helpCenter } from '../../src/handlers.js';
export default async req => helpCenter(req, context());
export const config = { path: ['/help', '/help/*'] };
