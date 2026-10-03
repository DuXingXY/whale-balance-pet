'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') throw new Error('此便携包构建脚本需要在 Windows 上运行。');
const root = path.resolve(__dirname, '..');
const slim = process.argv.includes('--slim');
const runtimeArg = process.argv.find(a => a.startsWith('--runtime='));
const outputArg = process.argv.find(a => a.startsWith('--output='));
const archiveArg = process.argv.find(a => a.startsWith('--archive='));
const archiveFormat = archiveArg?.slice(10);
if (archiveFormat && !['zip', '7z'].includes(archiveFormat)) throw new Error('压缩格式仅支持 --archive=zip 或 --archive=7z。');
const runtime = runtimeArg ? path.resolve(runtimeArg.slice(10)) : path.dirname(require('electron'));
const target = outputArg ? path.resolve(outputArg.slice(9)) : path.join(root, 'dist', 'WhaleBalance-win32-' + process.arch + (slim ? '-slim' : ''));
const archive = archiveFormat ? target + '.' + archiveFormat : null;
if (!fs.existsSync(path.join(runtime, 'electron.exe'))) throw new Error('Electron 运行时不存在，请先 npm install。');
const runtimeRelative = path.relative(runtime, target);
if (!runtimeRelative || (!runtimeRelative.startsWith('..' + path.sep) && runtimeRelative !== '..' && !path.isAbsolute(runtimeRelative))) throw new Error('构建目录不能位于 Electron 运行时目录中。');
if (fs.existsSync(target)) throw new Error('构建目录已存在，请选择新的 --output 目录或先将旧目录移走：' + target);
if (archive && fs.existsSync(archive)) throw new Error('压缩包已存在，请选择新的 --output 目录：' + archive);
// This application uses software rendering. Only the pinned, tested runtime
// may omit optional GPU libraries; future Electron upgrades need a new audit.
if (slim && fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim() !== '44.5.1') throw new Error('瘦身构建仅验证过 Electron 44.5.1，请使用当前依赖版本或进行完整构建。');
const omittedRuntime = new Set(['d3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'resources/default_app.asar']);
const locales = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak']);
const skins = require('../assets/skins.json');
const usedAssets = new Set(['skins.json', 'DSniang02.png', 'Ya1.mp3', ...Object.values(skins).map(s => s.file)]);
for (const file of usedAssets) if (!fs.existsSync(path.join(root, 'assets', file))) throw new Error('缺少运行素材：' + file);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(runtime, target, { recursive: true, filter: source => {
  if (!slim) return true;
  const relative = path.relative(runtime, source).split(path.sep).join('/');
  return !omittedRuntime.has(relative) && (!relative.startsWith('locales/') || locales.has(path.basename(source)));
} });
fs.renameSync(path.join(target, 'electron.exe'), path.join(target, 'WhaleBalance.exe'));
const app = path.join(target, 'resources', 'app'); fs.mkdirSync(app, { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'package.json', 'core', 'ui', 'assets', 'LICENSE', 'LICENSE-UPSTREAM', 'README.md', 'CREDITS.md', 'SOURCES-AND-LICENSES.md', 'UPSTREAM-PROVENANCE.md']) {
  const source = path.join(root, file);
  fs.cpSync(source, path.join(app, file), { recursive: true, filter: asset => !slim || file !== 'assets' || asset === source || usedAssets.has(path.relative(source, asset).split(path.sep).join('/')) });
}
fs.copyFileSync(path.join(root, 'README.md'), path.join(target, '使用说明.md'));
function bytes(directory) { return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => { const file = path.join(directory, entry.name); return sum + (entry.isDirectory() ? bytes(file) : fs.statSync(file).size); }, 0); }
console.log('已生成' + (slim ? '瘦身' : '完整') + '便携包：' + target + '（' + (bytes(target) / 1024 ** 2).toFixed(2) + ' MiB）');
console.log('保留完整文件夹，运行 WhaleBalance.exe；发布时压缩整个文件夹。');
if (archive) {
  const options = 'compression-level=9' + (archiveFormat === 'zip' ? ',hdrcharset=UTF-8' : '');
  const result = spawnSync('tar.exe', ['--format', archiveFormat === '7z' ? '7zip' : 'zip', '--options', options, '-cf', archive, '-C', path.dirname(target), path.basename(target)], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('压缩失败；已生成的程序目录可继续使用。需要支持此压缩格式的 Windows tar.exe。' + (result.error ? ' ' + result.error.message : ''));
  console.log('已生成压缩包：' + archive + '（' + (fs.statSync(archive).size / 1024 ** 2).toFixed(2) + ' MiB）');
}
