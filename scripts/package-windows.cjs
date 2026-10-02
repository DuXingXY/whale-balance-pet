'use strict';
const fs = require('node:fs'), path = require('node:path');
if (process.platform !== 'win32') throw new Error('此便携包构建脚本需要在 Windows 上运行。');
const root = path.resolve(__dirname, '..');
const runtimeArg = process.argv.find(a => a.startsWith('--runtime='));
const runtime = runtimeArg ? path.resolve(runtimeArg.slice(10)) : path.dirname(require('electron'));
const target = path.join(root, 'dist', 'WhaleBalance-win32-' + process.arch);
if (!fs.existsSync(path.join(runtime, 'electron.exe'))) throw new Error('Electron 运行时不存在，请先 npm install。');
if (fs.existsSync(target)) throw new Error('构建目录已存在，请将 dist/WhaleBalance-win32-' + process.arch + ' 移走后重试。');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.cpSync(runtime, target, { recursive: true });
fs.renameSync(path.join(target, 'electron.exe'), path.join(target, 'WhaleBalance.exe'));
const app = path.join(target, 'resources', 'app'); fs.mkdirSync(app, { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'package.json', 'core', 'ui', 'assets', 'LICENSE', 'LICENSE-UPSTREAM', 'README.md', 'CREDITS.md', 'SOURCES-AND-LICENSES.md', 'UPSTREAM-PROVENANCE.md']) {
  fs.cpSync(path.join(root, file), path.join(app, file), { recursive: true });
}
fs.copyFileSync(path.join(root, 'README.md'), path.join(target, '使用说明.md'));
console.log('已生成便携包：' + target);
console.log('保留完整文件夹，运行 WhaleBalance.exe；发布时压缩整个文件夹。');
