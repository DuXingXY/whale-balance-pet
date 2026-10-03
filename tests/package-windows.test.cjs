'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/package-windows.cjs');
function fixture(t, version = '44.5.1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-package-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(root), temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith('whale-package-test-')) throw new Error('Refusing cleanup outside the test fixture directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, 'electron.exe'), 'fixture');
  fs.writeFileSync(path.join(runtime, 'version'), version);
  const target = path.join(root, 'output');
  const run = (...args) => spawnSync(process.execPath, [script, '--slim', '--runtime=' + runtime, '--output=' + target, ...args], { encoding: 'utf8', windowsHide: true });
  return { root, runtime, target, run };
}
const windows = { skip: process.platform !== 'win32' };
test('packaging refuses existing program directories without overwriting them', windows, t => {
  const f = fixture(t); fs.mkdirSync(f.target); const sentinel = path.join(f.target, 'keep.txt'); fs.writeFileSync(sentinel, 'keep');
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /构建目录已存在/);
  assert.deepEqual(fs.readdirSync(f.target), ['keep.txt']); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
test('packaging refuses existing archives and unsupported archive formats before copying', windows, t => {
  const f = fixture(t); fs.writeFileSync(f.target + '.zip', 'keep archive');
  let result = f.run('--archive=zip'); assert.notEqual(result.status, 0); assert.match(result.stderr, /压缩包已存在/);
  assert.equal(fs.readFileSync(f.target + '.zip', 'utf8'), 'keep archive'); assert(!fs.existsSync(f.target));
  result = f.run('--archive=rar'); assert.notEqual(result.status, 0); assert.match(result.stderr, /压缩格式仅支持/); assert(!fs.existsSync(f.target));
});
test('slim packaging refuses an unaudited runtime without creating a partial build', windows, t => {
  const f = fixture(t, '99.0.0'); const result = f.run();
  assert.notEqual(result.status, 0); assert.match(result.stderr, /仅验证过 Electron 44\.5\.1/); assert(!fs.existsSync(f.target));
});
test('packaging prevents recursive copies into the runtime directory', windows, t => {
  const f = fixture(t), target = path.join(f.runtime, 'nested');
  const result = spawnSync(process.execPath, [script, '--runtime=' + f.runtime, '--output=' + target], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /不能位于 Electron 运行时目录中/);
  assert(!fs.existsSync(target)); assert.deepEqual(fs.readdirSync(f.runtime).sort(), ['electron.exe', 'version']);
});
