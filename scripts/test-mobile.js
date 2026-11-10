// scripts/test-mobile.js: THE DESK AND THE HELP CENTER AT PHONE WIDTH (390px) in a real browser: no page may scroll sideways, and the bottom tab bar must stay on screen. See scripts/tools/mobile-shots.mjs (run it by hand to get screenshots).
import { spawnSync } from 'child_process'; import os from 'os'; import path from 'path'; import fs from 'fs';
import { check, done } from './lib/check.js';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-')), r = spawnSync('node', ['scripts/tools/mobile-shots.mjs', out], { encoding: 'utf8', timeout: 170000 });
const text = (r.stdout || '') + (r.stderr || '');
check('no desk, help center or marketing page scrolls sideways at 390px wide', /No page scrolls sideways/.test(text) && !/SIDEWAYS/.test(text));
check('no page script error at phone width', !/PAGE ERROR/.test(text));
check('every screen could be opened and photographed', !/FAILED|CLICK/.test(text) && fs.readdirSync(out).length >= 12);
if (r.status !== 0) console.log(text.slice(0, 2000));
done();
