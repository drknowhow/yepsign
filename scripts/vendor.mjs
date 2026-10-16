// Copies the browser builds of pdf.js, pdf-lib, fontkit and perfect-freehand
// into extension/vendor/ and downloads the handwriting fonts listed in
// extension/lib/fonts.js. That folder is git-ignored; run `npm run vendor` after
// `npm install`. MV3 forbids remote code, so everything ships inside the extension.
import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS } from '../extension/lib/fonts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'extension', 'vendor');
const nm = (p) => join(root, 'node_modules', p);
const FONT_REPO = 'https://raw.githubusercontent.com/google/fonts/main/';

const FILES = [
  // The legacy build carries polyfills the modern one assumes (Math.sumPrecise).
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['pdfjs-dist/LICENSE', 'LICENSE.pdfjs'],
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.js'],
  ['pdf-lib/LICENSE.md', 'LICENSE.pdf-lib.md'],
  ['opentype.js/dist/opentype.module.js', 'opentype.module.js'],
  ['opentype.js/LICENSE', 'LICENSE.opentype'],
  ['perfect-freehand/dist/esm/index.mjs', 'perfect-freehand.mjs'],
  ['perfect-freehand/LICENSE', 'LICENSE.perfect-freehand']
];
// pdf.js fetches these at runtime: CJK cmaps, the 14 standard fonts, JPX/JBIG2
// decoders and the CMYK colour profile.
const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

const exists = (p) => stat(p).then(() => true, () => false);
const fontsDir = join(vendor, 'fonts');
const keep = new Map();
for (const f of FONTS.filter((f) => f.file)) {
  for (const name of [f.file, `${f.id}-LICENSE.txt`]) {
    const p = join(fontsDir, name);
    if (await exists(p)) keep.set(name, await readFile(p));
  }
}

await rm(vendor, { recursive: true, force: true });
await mkdir(join(vendor, 'pdfjs'), { recursive: true });
for (const [from, to] of FILES) {
  await copyFile(nm(from), join(vendor, to));
  console.log('copied', to);
}
for (const dir of DIRS) {
  await cp(nm(`pdfjs-dist/${dir}`), join(vendor, 'pdfjs', dir), { recursive: true });
  console.log('copied', `pdfjs/${dir}/`);
}

// fontkit's UMD build bundles pako; wrapped so pages and Node import it as a module.
const umd = await readFile(nm('@pdf-lib/fontkit/dist/fontkit.umd.min.js'), 'utf8');
await writeFile(join(vendor, 'fontkit.mjs'), `const self = globalThis;\n${umd}\nexport default globalThis.fontkit;\n`);
console.log('wrapped fontkit.mjs');

await mkdir(fontsDir, { recursive: true });
async function fetchTo(path, name) {
  if (keep.has(name)) return writeFile(join(fontsDir, name), keep.get(name));
  const url = FONT_REPO + path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await writeFile(join(fontsDir, name), Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', name);
}
for (const f of FONTS.filter((f) => f.file)) {
  await fetchTo(f.src, f.file);
  await fetchTo(f.license, `${f.id}-LICENSE.txt`);
}

// Without fontTools the full fonts still work; saved PDFs are just larger.
const files = FONTS.filter((f) => f.file).map((f) => join(fontsDir, f.file) + (f.rename ? `=${f.rename}` : ''));
const slim = spawnSync('python', [join(root, 'scripts', 'slim_fonts.py'), ...files], { stdio: 'inherit' });
if (slim.status !== 0) console.warn('fonts not slimmed (needs Python with fontTools); embedding full fonts');
