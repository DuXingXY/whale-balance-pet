'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/compact-storage.ps1');
const windows = { skip: process.platform !== 'win32' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-storage-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith('whale-storage-test-')) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.rmSync(dir + '.storage.json', { force: true });
  });
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Directory', dir, ...args], { encoding: 'utf8', windowsHide: true });
  return { dir, run };
}
test('storage optimization refuses unrelated folders before changing any files', windows, t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.dir, 'keep.txt'), 'keep');
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /not a WhaleBalance/);
  assert.deepEqual(fs.readdirSync(f.dir), ['keep.txt']);
});
test('LZX compression reduces disk storage and restores every byte without changing content', windows, t => {
  const f = fixture(t), manifest = path.join(f.dir, 'resources', 'app'); fs.mkdirSync(manifest, { recursive: true });
  fs.writeFileSync(path.join(manifest, 'package.json'), JSON.stringify({ name: 'whale-balance-pet', version: 'test' }));
  const file = path.join(f.dir, 'WhaleBalance.exe'); fs.writeFileSync(file, '0123456789ABCDEF'.repeat(32768));
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), original = hash();
  let r = f.run(); assert.equal(r.status, 0, r.stderr);
  let report = JSON.parse(fs.readFileSync(f.dir + '.storage.json', 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(report.contentVerified, true); assert(report.storedBytes < report.logicalBytes / 2); assert.equal(hash(), original);
  r = f.run('-Restore'); assert.equal(r.status, 0, r.stderr);
  report = JSON.parse(fs.readFileSync(f.dir + '.storage.json', 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(report.operation, 'restore'); assert.equal(report.storedBytes, report.logicalBytes); assert.equal(hash(), original);
});
test('storage optimization refuses linked subdirectories rather than traversing them', windows, t => {
  const f = fixture(t), manifest = path.join(f.dir, 'resources', 'app'); fs.mkdirSync(manifest, { recursive: true });
  fs.writeFileSync(path.join(manifest, 'package.json'), JSON.stringify({ name: 'whale-balance-pet' }));
  fs.writeFileSync(path.join(f.dir, 'WhaleBalance.exe'), 'fixture');
  const external = path.join(f.dir, 'outside'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'keep.txt'), 'keep');
  const link = path.join(f.dir, 'linked'); fs.symlinkSync(external, link, 'junction');
  t.after(() => { if (fs.existsSync(link)) fs.rmdirSync(link); });
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /Linked subdirectories/);
  assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'keep');
});
