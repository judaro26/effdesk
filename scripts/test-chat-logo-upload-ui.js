import fs from 'node:fs';
import { check, done } from './lib/check.js';

const js = fs.readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/desk.css', import.meta.url), 'utf8');

check('Live Chat settings provide a direct logo image upload control', js.includes("'aria-label': 'Upload customer chat logo'") && js.includes('uploadHelpImage(file)'));
check('logo uploads use the existing bounded and validated help image storage endpoint', js.includes("fetchFn('/api/help-assets/image?org='") && js.includes('file.size > 4 * 1024 * 1024'));
check('uploaded logos are saved by workspace-owned asset ID rather than a client-provided URL', js.includes('logoAssetId: logoAssetId || undefined'));
check('the settings preview updates immediately after upload and supports reverting to EffDesk branding', js.includes('logoAssetUrl = widgetOrigin + url') && js.includes('Use EffDesk logo'));
check('logo upload controls are styled and keyboard-accessible', css.includes('.chat-logo-upload input[type=file]') && js.includes('.chat-logo-controls'));

done();
