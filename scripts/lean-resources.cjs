'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunks(png) {
  assert(png.subarray(0, 8).equals(signature), 'Invalid PNG');
  const result = []; let offset = 8;
  while (offset < png.length) {
    assert(offset + 12 <= png.length, 'Truncated PNG');
    const length = png.readUInt32BE(offset), end = offset + length + 12;
    assert(end <= png.length, 'Truncated PNG chunk');
    const raw = png.subarray(offset, end), type = raw.subarray(4, 8).toString('ascii');
    assert.equal(crc32(raw.subarray(4, -4)), raw.readUInt32BE(raw.length - 4), 'PNG CRC mismatch');
    result.push({ type, raw, data: raw.subarray(8, -4) }); offset = end;
  }
  assert.equal(result.at(-1)?.type, 'IEND'); return result;
}
function makeChunk(type, data) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length, 0); result.write(type, 4, 'ascii'); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result;
}
function optimizePNG(png) {
  const all = chunks(png); if (all.some(c => c.type === 'acTL')) return png;
  const original = Buffer.concat(all.filter(c => c.type === 'IDAT').map(c => c.data));
  assert(original.length, 'PNG has no image data');
  const raw = zlib.inflateSync(original);
  let best = original;
  for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
    const compressed = zlib.deflateSync(raw, { level: 9, strategy }); if (compressed.length < best.length) best = compressed;
  }
  assert(zlib.inflateSync(best).equals(raw), 'PNG scanlines changed');
  let written = false;
  const result = Buffer.concat([signature, ...all.flatMap(c => c.type !== 'IDAT' ? [c.raw] : written ? [] : (written = true, [makeChunk('IDAT', best)]))]);
  return result.length < png.length ? result : png;
}
function optimizePak(input) {
  assert.equal(input.readUInt32LE(0), 5, 'Only audited DataPack v5 is supported');
  const count = input.readUInt16LE(8), aliases = input.readUInt16LE(10);
  const tableEnd = 12 + (count + 1) * 6 + aliases * 4;
  assert.equal(input.readUInt32LE(14), tableEnd, 'Unexpected DataPack padding');
  assert.equal(input.readUInt32LE(14 + count * 6), input.length, 'Unexpected DataPack trailer');
  const entries = [], data = [];
  for (let i = 0; i < count; i++) {
    const id = input.readUInt16LE(12 + i * 6), start = input.readUInt32LE(14 + i * 6), end = input.readUInt32LE(20 + i * 6);
    assert(start >= tableEnd && end >= start && end <= input.length, 'Invalid DataPack offsets');
    const bytes = input.subarray(start, end);
    entries.push(id); data.push(bytes.subarray(0, 8).equals(signature) ? optimizePNG(bytes) : bytes);
  }
  const header = Buffer.from(input.subarray(0, tableEnd)); let offset = tableEnd;
  for (let i = 0; i <= count; i++) { header.writeUInt32LE(offset, 14 + i * 6); if (i < count) offset += data[i].length; }
  return Buffer.concat([header, ...data]);
}
function deduplicateCredits(html) {
  const seen = new Map(); let references = 0;
  const output = html.replace(/<pre>([\s\S]*?)<\/pre>/g, (_match, body) => {
    if (seen.has(body)) { references++; const id = seen.get(body); return `<p data-whale-license-ref="${id}"><a href="#${id}">Identical licence and attribution text (shown in full above)</a></p>`; }
    const id = 'whale-license-' + seen.size; seen.set(body, id);
    return `<pre id="${id}">${body}</pre>`;
  });
  assert(seen.size > 0, 'No licence text found');
  assert.equal(restoreCredits(output), html, 'Licence text or component mapping changed');
  return { output, unique: seen.size, references };
}
function restoreCredits(html) {
  const bodies = new Map();
  return html.replace(/<pre id="(whale-license-\d+)">([\s\S]*?)<\/pre>|<p data-whale-license-ref="(whale-license-\d+)"><a href="#\3">Identical licence and attribution text \(shown in full above\)<\/a><\/p>/g, (_match, id, body, ref) => {
    if (id) { bodies.set(id, body); return '<pre>' + body + '</pre>'; }
    assert(bodies.has(ref), 'Broken licence reference'); return '<pre>' + bodies.get(ref) + '</pre>';
  });
}
function optimizeFolder(directory) {
  const files = [], credits = path.join(directory, 'LICENSES.chromium.html');
  function rewrite(file, transform) {
    const original = fs.readFileSync(file), output = transform(original);
    assert(output.length <= original.length, 'Optimization enlarged a file');
    if (output.length < original.length) fs.writeFileSync(file, output);
    files.push({ file: path.relative(directory, file), beforeBytes: original.length, afterBytes: output.length });
  }
  let licenceStats;
  rewrite(credits, bytes => { const r = deduplicateCredits(bytes.toString('utf8')); licenceStats = { unique: r.unique, references: r.references }; return Buffer.from(r.output); });
  for (const name of ['resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak']) rewrite(path.join(directory, name), optimizePak);
  const assets = path.join(directory, 'resources', 'app', 'assets');
  for (const name of fs.readdirSync(assets)) if (name.endsWith('.png')) rewrite(path.join(assets, name), optimizePNG);
  return { files, licenceStats, savedBytes: files.reduce((sum, f) => sum + f.beforeBytes - f.afterBytes, 0), imageScanlinesUnchanged: true, licenceOriginalRestoredExactly: true };
}
module.exports = { crc32, makeChunk, chunks, optimizePNG, optimizePak, deduplicateCredits, restoreCredits, optimizeFolder };
