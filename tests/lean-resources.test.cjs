'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib');
const { makeChunk, chunks, optimizePNG, optimizePak, deduplicateCredits, restoreCredits } = require('../scripts/lean-resources.cjs');
function png(extra = []) {
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const scanline = Buffer.alloc(65, 100); scanline[0] = 0;
  const data = zlib.deflateSync(scanline, { level: 0 });
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), makeChunk('IHDR', header), makeChunk('tEXt', Buffer.from('Source\0Original attribution')), ...extra, makeChunk('IDAT', data.subarray(0, 20)), makeChunk('IDAT', data.subarray(20)), makeChunk('IEND', Buffer.alloc(0))]);
}
function rawImage(image) { return zlib.inflateSync(Buffer.concat(chunks(image).filter(c => c.type === 'IDAT').map(c => c.data))); }
test('licence deduplication preserves every component and restores the original HTML exactly', () => {
  const common = 'Complete licence text with attribution &amp; punctuation.\r\n'.repeat(50);
  const different = common.replace('attribution', 'a different copyright owner');
  const html = `<html><div>Project A<pre>${common}</pre></div><div>Project B<pre>${common}</pre></div><div>Project C<pre>${different}</pre></div></html>`;
  const result = deduplicateCredits(html);
  assert.equal(result.unique, 2); assert.equal(result.references, 1); assert(result.output.length < html.length);
  assert.equal(restoreCredits(result.output), html); assert(result.output.includes('Project B'));
  assert.throws(() => restoreCredits('<p data-whale-license-ref="whale-license-9"><a href="#whale-license-9">Identical licence and attribution text (shown in full above)</a></p>'), /Broken licence reference/);
});
test('PNG optimization changes only the image encoding, preserving scanlines and metadata bytes', () => {
  const original = png(), optimized = optimizePNG(original);
  assert(optimized.length < original.length); assert(rawImage(optimized).equals(rawImage(original)));
  assert.deepEqual(chunks(optimized).filter(c => c.type !== 'IDAT').map(c => c.raw), chunks(original).filter(c => c.type !== 'IDAT').map(c => c.raw));
  assert(optimizePNG(optimized).equals(optimized));
});
test('PNG optimization rejects corrupt input and leaves animated PNGs unchanged', () => {
  const corrupt = png(); corrupt[20] ^= 1; assert.throws(() => optimizePNG(corrupt), /CRC mismatch/);
  const animated = png([makeChunk('acTL', Buffer.alloc(8))]); assert(optimizePNG(animated).equals(animated));
});
test('DataPack optimization preserves resource IDs, aliases and every non-image payload', () => {
  const resources = [png(), Buffer.from('text used by Chromium'), Buffer.from([0, 1, 2, 0xff])];
  const table = Buffer.alloc(12 + 4 * 6 + 4); table.writeUInt32LE(5, 0); table.writeUInt16LE(3, 8); table.writeUInt16LE(1, 10);
  let offset = table.length;
  for (let i = 0; i <= 3; i++) { table.writeUInt16LE(i === 3 ? 0 : 10 + i * 10, 12 + i * 6); table.writeUInt32LE(offset, 14 + i * 6); if (i < 3) offset += resources[i].length; }
  table.writeUInt16LE(40, 36); table.writeUInt16LE(0, 38);
  const original = Buffer.concat([table, ...resources]), optimized = optimizePak(original);
  assert(optimized.length < original.length); assert(optimized.subarray(36, 40).equals(original.subarray(36, 40)));
  for (let i = 0; i < 3; i++) {
    assert.equal(optimized.readUInt16LE(12 + i * 6), 10 + i * 10);
    const data = optimized.subarray(optimized.readUInt32LE(14 + i * 6), optimized.readUInt32LE(20 + i * 6));
    assert(i === 0 ? rawImage(data).equals(rawImage(resources[0])) : data.equals(resources[i]));
  }
  assert.equal(optimized.readUInt32LE(32), optimized.length);
});
