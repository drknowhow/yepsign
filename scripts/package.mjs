// Builds dist/yepsign-<version>.zip from extension/, ready to upload to the
// Chrome Web Store or attach to a release. Refuses to build when the vendored
// libraries are missing or the manifest and package.json versions disagree.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { FONTS } from '../extension/lib/fonts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json is ${manifest.version} but package.json is ${pkg.version}; make them match`);
}
const required = ['vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js', 'vendor/fontkit.mjs',
  'vendor/opentype.module.js', 'vendor/perfect-freehand.mjs', ...FONTS.filter((f) => f.file).map((f) => `vendor/fonts/${f.file}`)];
for (const file of required) {
  await stat(join(ext, file)).catch(() => { throw new Error(`${file} is missing; run npm run vendor first`); });
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

// A minimal zip writer (deflate, no zip64): the extension is a few MB.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const when = new Date(2026, 0, 1);
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime(when), 10);
    head.writeUInt16LE(dosDate(when), 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime(when), 12);
    cen.writeUInt16LE(dosDate(when), 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const files = (await walk(ext)).sort();
const entries = [];
for (const file of files) {
  entries.push({ name: relative(ext, file).split(sep).join('/'), data: await readFile(file) });
}
const out = join(root, 'dist', `yepsign-${manifest.version}.zip`);
await mkdir(dirname(out), { recursive: true });
const bytes = zip(entries);
await writeFile(out, bytes);
console.log(`${relative(root, out)}: ${entries.length} files, ${(bytes.length / 1e6).toFixed(2)} MB`);
