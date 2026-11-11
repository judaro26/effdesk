// scripts/minify-assets.js: RUNS AT DEPLOY TIME (see netlify.toml). Shrinks every script and stylesheet in public/ in place: whitespace, comments and local names go, behaviour does not.
// The files in git stay readable; only the deployed copies are minified. Scripts are classic scripts, so esbuild leaves their top-level names alone.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { transform } from 'esbuild';
const root = process.env.PUBLIC_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let before = 0, after = 0;
for (const f of fs.readdirSync(root, { recursive: true })) {
  const m = /\.(js|css)$/.exec(String(f)); if (!m) continue;
  const file = path.join(root, String(f)), src = fs.readFileSync(file, 'utf8');
  const out = await transform(src, { loader: m[1], minify: true, legalComments: 'none', target: m[1] === 'js' ? 'es2018' : 'chrome90' });
  fs.writeFileSync(file, out.code); before += src.length; after += out.code.length;
  console.log(`${String(f).padEnd(28)} ${String(src.length).padStart(7)} -> ${String(out.code.length).padStart(7)}`);
}
console.log(`total ${before} -> ${after} bytes (${Math.round(100 - after / before * 100)}% smaller)`);
