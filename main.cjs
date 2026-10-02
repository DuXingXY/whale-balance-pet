'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen, shell, safeStorage, clipboard } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require('node:url');
const { Store } = require('./core/store.cjs'); const { BalanceProvider } = require('./core/providers.cjs'); const { Monitor } = require('./core/monitor.cjs');
const { placePet } = require('./core/placement.cjs');
const skins = require('./assets/skins.json');
app.setName('WhaleBalance');
const demo = process.argv.includes('--demo'); const qa = process.argv.includes('--qa');
const explicitData = process.argv.find(a => a.startsWith('--data-dir='))?.slice(11);
if (explicitData) app.setPath('userData', path.resolve(explicitData));
else if (demo) app.setPath('userData', path.join(app.getPath('temp'), 'whale-balance-demo-' + process.pid));
if (process.platform === 'win32') { app.disableHardwareAcceleration(); app.setAppUserModelId('WhaleBalance.Desktop'); }
if (!app.requestSingleInstanceLock()) { app.quit(); }
let store, monitor, pet, manager, tray, quitting = false, dragStart = null;
let petAnchor, petLayout, placing = false;
const uiPath = f => path.join(__dirname, 'ui', f);
const windowOptions = { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') };
function snapshot() { return { ...store.public(), states: monitor.all(), petLayout, skins, demo, encryptionAvailable: safeStorage.isEncryptionAvailable() }; }
function broadcast() { const s = snapshot(); for (const win of [pet, manager]) if (win && !win.isDestroyed()) win.webContents.send('state', s); }
function protect(win, file) {
  const trusted = pathToFileURL(file).href;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== trusted) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.loadFile(file);
}
function openManager() {
  if (manager && !manager.isDestroyed()) { manager.show(); manager.focus(); return; }
  manager = new BrowserWindow({ width: 1100, height: 790, minWidth: 820, minHeight: 600, title: '鲸鱼余额 · 站点管理', backgroundColor: '#0e1421', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'whale.png'), webPreferences: windowOptions });
  protect(manager, uiPath('manager.html'));
  manager.on('closed', () => { manager = null; });
}
function petShow() { if (pet && !pet.isDestroyed()) { fitPet(); pet.showInactive(); broadcast(); } }
async function refreshAll() { await Promise.all(store.data.sites.map(p => monitor.refresh(p.id))); }
function savePosition() { if (!pet?.isDestroyed()) { store.data.position = pet.getPosition(); store.data.petAnchor = petAnchor; store.persist(); } }
function fitPet(snap = false) {
  if (!pet || pet.isDestroyed() || placing) return;
  placing = true;
  try {
    if (pet.isMaximized()) pet.unmaximize();
    const [width, height] = pet.getContentSize();
    if (width !== 340 || height !== 470) pet.setContentSize(340, 470);
    const b = pet.getBounds(), size = store.data.preferences.petSize;
    const work = screen.getDisplayNearestPoint({ x: Math.round(petAnchor.x + size / 2), y: Math.round(petAnchor.y + size / 2) }).workArea;
    petLayout = placePet(petAnchor, size, work, { snap: snap && store.data.preferences.snap, width: b.width, height: b.height, bounds: skins[store.data.preferences.skin].bounds });
    petAnchor = petLayout.anchor;
    if (petLayout.window.x !== b.x || petLayout.window.y !== b.y) pet.setPosition(petLayout.window.x, petLayout.window.y);
    pet.webContents.send('layout', petLayout);
  } finally {
    placing = false;
  }
}
function endDrag() {
  dragStart = null;
  fitPet(true);
  savePosition();
}
function trust(event, role) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const valid = role === 'manager' ? win === manager : role === 'pet' ? win === pet : win === pet || win === manager;
  const wanted = win === manager ? 'manager.html' : 'pet.html';
  if (!valid || event.senderFrame?.url !== pathToFileURL(uiPath(wanted)).href) throw new Error('无效的界面请求');
}
function handle(name, role, fn) {
  ipcMain.handle(name, async (event, arg) => {
    try { trust(event, role); return { ok: true, value: await fn(arg) }; }
    catch (error) { return { ok: false, error: error.code ? error.message : name.includes('site') || name === 'test' ? error.message : '操作未完成，请重试', ...(name === 'test' ? { code: error.code || 'CONFIG', details: error.details || {} } : {}) }; }
  });
}
app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), {
    encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('本机凭据加密不可用，无法保存 Key'); return safeStorage.encryptString(value).toString('base64'); },
    decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
  });
  if (demo && !store.data.sites.length) {
    for (const input of [
      { name: 'BB API', provider: 'sub2api', baseUrl: 'https://www.bb-api.com', currency: 'USD' },
      { name: '我的备用站', provider: 'billing', baseUrl: 'https://example.invalid', currency: 'USD' },
      { name: 'DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', currency: 'CNY' },
    ]) store.save({ ...input, key: 'DEMO-NOT-A-REAL-KEY', threshold: 5 });
  }
  let provider = new BalanceProvider();
  if (demo) provider = { query: async p => ({ amount: p.provider === 'deepseek' ? 28.46 : p.provider === 'billing' ? 3.8 : 56.93, kind: p.provider === 'billing' ? 'api-balance' : 'wallet', used: null, currency: p.currency, windows: [], unlimited: false, adapter: p.provider }) };
  monitor = new Monitor(store, provider, { changed: broadcast, notify: (p, r) => {
    if (!demo && !qa && Notification.isSupported()) { const n = new Notification({ title: p.name + ' · 余额提醒', body: '可用金额 ' + r.amount.toFixed(2) + ' ' + r.currency + '，已达到设定阈值', icon: path.join(__dirname, 'assets', 'whale.png') }); n.on('click', openManager); n.show(); }
  } });
  const area = screen.getPrimaryDisplay().workArea;
  const saved = store.data.position;
  const bounds = { x: saved?.[0] ?? area.x + area.width - 365, y: saved?.[1] ?? area.y + area.height - 480, width: 340, height: 470 };
  if (!screen.getAllDisplays().some(d => bounds.x + 50 > d.workArea.x && bounds.x < d.workArea.x + d.workArea.width && bounds.y + 50 > d.workArea.y && bounds.y < d.workArea.y + d.workArea.height)) { bounds.x = area.x + area.width - 365; bounds.y = area.y + area.height - 480; }
  pet = new BrowserWindow({ ...bounds, useContentSize: true, transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: store.data.preferences.pinned, backgroundColor: '#00000000', webPreferences: { ...windowOptions, backgroundThrottling: false }, show: false });
  const size = store.data.preferences.petSize, savedAnchor = store.data.petAnchor;
  petAnchor = savedAnchor && Number.isFinite(savedAnchor.x) && Number.isFinite(savedAnchor.y) ? savedAnchor : { x: bounds.x + (size === 150 ? 136 : size === 230 ? 94 : 116), y: bounds.y + 470 - size - 17 };
  protect(pet, uiPath('pet.html'));
  pet.on('resize', () => fitPet());
  pet.on('move', () => { if (!dragStart) fitPet(); });
  pet.once('ready-to-show', petShow);
  pet.on('close', e => { if (!quitting) { e.preventDefault(); pet.hide(); } });
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'whale.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon); tray.setToolTip('鲸鱼余额 · 多站点桌宠');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示桌宠', click: petShow }, { label: '管理站点', click: openManager }, { type: 'separator' }, { label: '退出', click: () => app.quit() }])); tray.on('double-click', openManager);
  handle('get-state', 'any', () => snapshot());
  handle('open-manager', 'any', openManager);
  handle('save-site', 'manager', input => { const p = store.save(input); monitor.invalidate(p.id); broadcast(); monitor.refresh(p.id); return p; });
  handle('delete-site', 'manager', id => { if (typeof id !== 'string') throw new Error('站点标识无效'); monitor.invalidate(id); store.remove(id); broadcast(); });
  handle('select-site', 'manager', id => { store.select(id); store.preferences({ bubbleMode: 'selected' }); broadcast(); });
  handle('refresh', 'any', async id => { if (id === 'all') await refreshAll(); else await monitor.refresh(id); return snapshot(); });
  handle('test', 'manager', async input => { const { profile, key } = store.draft(input); return provider.query(profile, key); });
  handle('copy-test-result', 'manager', text => { if (typeof text !== 'string' || text.length > 20000) throw new Error('复制内容无效'); clipboard.writeText(text); });
  handle('preferences', 'manager', p => { store.preferences(p); pet.setAlwaysOnTop(store.data.preferences.pinned); fitPet(Object.hasOwn(p, 'skin') || Object.hasOwn(p, 'petSize')); broadcast(); });
  handle('open-dashboard', 'any', id => { const p = store.get(id); if (p) return shell.openExternal(p.dashboardUrl); });
  handle('hide-pet', 'any', () => pet.hide());
  handle('show-pet', 'any', petShow);
  ipcMain.on('drag', (event, a) => {
    try { trust(event, 'pet'); if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
      if (a.phase === 'start') { pet.setIgnoreMouseEvents(false); dragStart = { x: a.x, y: a.y, anchor: { ...petAnchor } }; }
      else if (a.phase === 'move' && dragStart) {
        petAnchor = { x: dragStart.anchor.x + a.x - dragStart.x, y: dragStart.anchor.y + a.y - dragStart.y }; fitPet();
      } else if (a.phase === 'end') endDrag();
    } catch {}
  });
  // Window regions also clip painting. In particular, Windows display scaling
  // can clip out the character and toolbar. Keep the entire transparent surface
  // drawable and change only mouse handling over blank pixels.
  ipcMain.on('mouse-pass-through', (event, ignore) => {
    try { trust(event, 'pet'); if (typeof ignore !== 'boolean' || (ignore && dragStart)) return;
      pet.setIgnoreMouseEvents(ignore, { forward: true });
    } catch {}
  });
  monitor.start();
  if (!qa && !store.data.sites.length) openManager();
}).catch(error => { fs.writeFileSync(path.join(app.getPath('temp'), 'whale-balance-startup.txt'), '启动失败，请检查数据文件与运行时。'); app.quit(); });
app.on('second-instance', () => { petShow(); openManager(); });
app.on('before-quit', () => { quitting = true; monitor?.stop(); if (store && pet && !pet.isDestroyed()) savePosition(); tray?.destroy(); });
app.on('window-all-closed', () => {});
