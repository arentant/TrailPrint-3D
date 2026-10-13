import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';

// Run with the static Noto Sans Armenian Bold TTF from the release in fonts/README.md.
const [source, destination = 'shared/assets/fonts/noto-sans-armenian-bold.typeface.json'] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/convert-armenian-font.mjs <NotoSansArmenian-Bold.ttf> [output.json]');
const bytes = await readFile(source);
const font = new TTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
font.glyphs = Object.fromEntries(Object.entries(font.glyphs).filter(([character]) => {
  const code = character.codePointAt(0);
  return (code >= 0x0530 && code <= 0x058f) || (code >= 0xfb13 && code <= 0xfb17);
}));
font.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(destination, `${JSON.stringify(font)}\n`);
console.log(`Converted ${Object.keys(font.glyphs).length} Armenian glyphs to ${destination}`);
