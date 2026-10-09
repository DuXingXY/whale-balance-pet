'use strict';
// Run with Electron itself. No external browser, automation driver or real Key.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv.includes('--demo') || !process.argv.includes('--qa')) throw new Error('界面自检必须使用 --demo --qa。');
if (process.argv.some(a => a.startsWith('--data-dir='))) throw new Error('界面自检使用独立演示目录，不接受 --data-dir。');
const outputArg = process.argv.find(a => a.startsWith('--qa-output='));
if (!outputArg) throw new Error('请指定新的 --qa-output=目录。');
const output = path.resolve(outputArg.slice(12));
if (fs.existsSync(output)) throw new Error('自检目录已存在，请指定新目录。');
fs.mkdirSync(output, { recursive: true });
require('../main.cjs');
const checks = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await fn()) return; await delay(30); }
  throw new Error('等待超时：' + message);
}
async function evaluate(win, source) {
  const value = await win.webContents.executeJavaScript('try { ' + source + ' } catch (error) { ({ __qaError: error.stack }) }');
  if (value?.__qaError) throw new Error(value.__qaError);
  return value;
}
function check(name, value) { assert.equal(value, true, name); checks.push(name); }
function watch(win) {
  win.webContents.on('console-message', (...args) => {
    const details = args[1];
    if (details?.level === 'error') errors.push(details.message);
    else if (details === 3) errors.push(args[2]);
  });
  win.webContents.on('render-process-gone', (_event, details) => errors.push('renderer: ' + details.reason));
}
async function capture(win, file) {
  win.webContents.debugger.attach('1.3');
  try {
    const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  } finally { win.webContents.debugger.detach(); }
}
async function run() {
  await app.whenReady();
  const pet = BrowserWindow.getAllWindows()[0]; watch(pet);
  await until(() => evaluate(pet, '!!window.whale && !!document.querySelector("#character-art")?.naturalWidth'), '桌宠加载');
  await evaluate(pet, 'window.whale.manage()');
  let manager;
  await until(() => { manager = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('manager.html')); return !!manager; }, '管理窗口');
  watch(manager);
  await until(() => evaluate(manager, 'document.querySelectorAll(".card").length === 3 && document.querySelector("#usage-panel")?.getAttribute("aria-busy") === "false"'), '演示站点和用量');
  check('演示模式及三个站点', await evaluate(manager, '!document.getElementById("demo-banner").hidden && document.querySelectorAll(".card").length === 3'));
  const originalPet = await evaluate(pet, 'window.whale.state()');
  const area = screen.getPrimaryDisplay().workArea;
  async function moveCharacter(x, y) {
    await evaluate(pet, `window.whale.drag({phase:'start',x:0,y:0}); window.whale.drag({phase:'move',x:${x},y:${y}}); window.whale.drag({phase:'end',x:${x},y:${y}})`);
    await delay(60);
  }
  for (const skin of Object.keys(originalPet.skins)) {
    await evaluate(manager, `window.whale.preferences({skin:${JSON.stringify(skin)},petSize:190,clickSound:false})`);
    await until(() => evaluate(pet, `document.getElementById('character').dataset.skin === ${JSON.stringify(skin)}`), '朝向测试皮肤加载');
    for (const side of ['left', 'right']) {
      const current = await evaluate(pet, 'window.whale.state()');
      await moveCharacter((side === 'left' ? area.x : area.x + area.width - 190) - current.petLayout.anchor.x, area.y + 300 - current.petLayout.anchor.y);
      const facing = side === 'left' ? 'right' : 'left';
      await until(() => evaluate(pet, '!turnAnimation'), '转向动画完成');
      check(skin + ' 在屏幕' + side + '侧朝向中心', await evaluate(pet, `document.getElementById('character').dataset.facing === '${facing}' && Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('character-visual')).transform).m11 - ${facing === 'right' ? -1 : 1}) < .0001`));
      check(skin + ' 翻转后透明轮廓点击检测正确 ' + side, await evaluate(pet, `(() => {
        const art = document.getElementById('character-art'), cache = imagePixels(art), p = cache.pixels, r = art.getBoundingClientRect(), frame = document.getElementById('character').getBoundingClientRect();
        let opaque = 0, transparent = 0;
        for (let py = 0; py < p.height; py += 17) for (let px = 0; px < p.width; px += 17) {
          const x = r.left + (${facing === 'right'} ? 1 - (px + .5) / p.width : (px + .5) / p.width) * r.width, y = r.top + (py + .5) / p.height * r.height;
          if (!inside(frame,x,y)) continue;
          const expected = p.data[(py*p.width+px)*4+3] > 35;
          if (hitImage(art,cache,x,y,null,${facing === 'right'}) !== expected) return false;
          if (expected) opaque++; else transparent++;
        }
        return opaque > 0 && transparent > 0;
      })()`));
      if (['default', 'lingxu'].includes(skin)) await capture(pet, path.join(output, 'facing-' + skin + '-' + side + '.png'));
      if (side === 'left') {
        await evaluate(pet, 'clickFeedback()');
        check(skin + ' 点击回弹保留朝向', await evaluate(pet, "Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('character-visual')).transform).m11 + 1) < .0001"));
        await delay(320);
      }
    }
  }
  async function setMotion(value) {
    if (!pet.webContents.debugger.isAttached()) pet.webContents.debugger.attach('1.3');
    await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await delay(60);
  }
  async function crossMiddle(side, size) {
    const current = await evaluate(pet, 'window.whale.state()');
    await moveCharacter(area.x + area.width / 2 - size / 2 + (side === 'left' ? -120 : 120) - current.petLayout.anchor.x, 0);
  }
  for (const size of [150, 190, 230]) {
    await evaluate(manager, `window.whale.preferences({skin:'lingxu',petSize:${size}})`);
    await crossMiddle('left', size);
    await until(() => evaluate(pet, '!turnAnimation'), '翻转起始朝向');
    await crossMiddle('right', size);
    check(size + ' 跨中线启动纸片翻转', await evaluate(pet, "!!turnAnimation && document.getElementById('character').dataset.facing === 'left'"));
    await evaluate(pet, 'turnAnimation.pause(); turnAnimation.currentTime = 200');
    check(size + ' 翻到中间时收窄为纸片边缘', await evaluate(pet, "document.getElementById('character-visual').getBoundingClientRect().width < document.getElementById('character').getBoundingClientRect().width * .01"));
    if (size === 190) {
      for (const [label, time] of [['start', 0], ['closing', 140], ['edge', 200], ['opening', 260], ['end', 400]]) {
        await evaluate(pet, `turnAnimation.currentTime = ${time}`);
        if (['closing', 'opening'].includes(label)) {
          check('纸片' + label + '阶段点击轮廓跟随当前朝向', await evaluate(pet, `(() => {
            const art = document.getElementById('character-art'), cache = imagePixels(art), p = cache.pixels, r = art.getBoundingClientRect(), frame = document.getElementById('character').getBoundingClientRect();
            const mirrored = new DOMMatrix(getComputedStyle(document.getElementById('character-visual')).transform).m11 < 0;
            let opaque = 0, transparent = 0;
            for (let py = 0; py < p.height; py += 17) for (let px = 0; px < p.width; px += 17) {
              const x = r.left + (mirrored ? 1 - (px + .5) / p.width : (px + .5) / p.width) * r.width, y = r.top + (py + .5) / p.height * r.height;
              if (!inside(frame,x,y)) continue;
              const expected = p.data[(py*p.width+px)*4+3] > 35;
              if (hitImage(art,cache,x,y,null,Math.cos(turnAngle()*Math.PI/180) < 0) !== expected) return false;
              if (expected) opaque++; else transparent++;
            }
            return opaque > 0 && transparent > 0;
          })()`));
        }
        await capture(pet, path.join(output, 'paper-flip-' + label + '.png'));
      }
    }
    await evaluate(pet, 'turnAnimation.currentTime = 140; globalThis.qaTurnAngle = turnAngle(); globalThis.qaTurn = turnAnimation');
    // A layout update in the same half must keep the existing transition.
    await moveCharacter(5, 0);
    check(size + ' 同侧拖动不重启动画', await evaluate(pet, 'turnAnimation === qaTurn'));
    await crossMiddle('left', size);
    check(size + ' 快速拖回从当前角度反转', await evaluate(pet, "!!turnAnimation && turnAnimation !== qaTurn && Math.abs(turnFrom - qaTurnAngle) < .001 && document.getElementById('character').dataset.facing === 'right'"));
    await until(() => evaluate(pet, '!turnAnimation'), '反转完成');
    check(size + ' 反转完成后人物完全展开', await evaluate(pet, "Math.abs(document.getElementById('character-visual').getBoundingClientRect().width - document.getElementById('character').getBoundingClientRect().width) < .01"));
  }
  await setMotion('reduce');
  await crossMiddle('right', 230);
  check('减少动画时立即转向', await evaluate(pet, "!turnAnimation && document.getElementById('character').dataset.facing === 'left' && Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('character-visual')).transform).m11 - 1) < .0001"));
  await setMotion('no-preference');
  await crossMiddle('left', 230);
  check('恢复动画后转向重新播放', await evaluate(pet, '!!turnAnimation'));
  await setMotion('reduce');
  check('翻转期间开启减少动画会立即完成', await evaluate(pet, "!turnAnimation && Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('character-visual')).transform).m11 + 1) < .0001"));
  await setMotion('no-preference');
  pet.webContents.debugger.detach();
  await evaluate(manager, `window.whale.preferences(${JSON.stringify(originalPet.preferences)})`);
  const restorePet = await evaluate(pet, 'window.whale.state()');
  await moveCharacter(originalPet.petLayout.anchor.x - restorePet.petLayout.anchor.x, originalPet.petLayout.anchor.y - restorePet.petLayout.anchor.y);
  await evaluate(manager, 'document.querySelector("[data-usage-tab=spending]").click()');
  check('金额面板提供每日记录、站点选择及秒表', await evaluate(manager, '!document.getElementById("usage-spending-view").hidden && document.querySelectorAll(".spend-day-card").length === 3 && document.querySelectorAll("#spend-timer-site option").length === 3 && document.querySelectorAll("#spend-rows tr").length === 3'));
  await evaluate(manager, 'document.getElementById("spend-start").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "计时中" && !document.getElementById("spend-pause").disabled'), '秒表开始');
  await until(() => evaluate(manager, 'document.getElementById("spend-time").textContent !== "00:00:00"'), '秒表秒数更新');
  check('秒表运行时更新时间、锁定站点并显示金额', await evaluate(manager, 'document.getElementById("spend-time").textContent !== "00:00:00" && document.getElementById("spend-timer-site").disabled && document.getElementById("spend-amount").textContent !== "—"'));
  await evaluate(manager, 'document.getElementById("spend-pause").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "已暂停" && !document.getElementById("spend-resume").disabled'), '秒表暂停');
  const pausedTime = await evaluate(manager, 'document.getElementById("spend-time").textContent'); await delay(1100);
  check('暂停后秒数冻结且显示继续入口', await evaluate(manager, 'document.getElementById("spend-time").textContent') === pausedTime);
  await evaluate(manager, 'document.getElementById("spend-resume").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "计时中" && !document.getElementById("spend-stop").disabled'), '秒表继续');
  await evaluate(manager, 'document.getElementById("spend-stop").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "已结束" && !document.getElementById("spend-reset").disabled'), '秒表结束');
  check('结束后保留金额结果与重置入口', await evaluate(manager, 'document.getElementById("spend-amount").textContent !== "—" && !document.getElementById("spend-reset").hidden'));
  await evaluate(manager, 'document.getElementById("spend-site").value = document.getElementById("spend-site").options[1].value; document.getElementById("spend-site").dispatchEvent(new Event("change"))');
  check('每日金额可按站点筛选', await evaluate(manager, 'document.querySelectorAll(".spend-day-card").length === 1 && document.querySelectorAll("#spend-rows tr").length === 1'));
  await evaluate(manager, 'document.getElementById("spend-site").value = "all"; document.getElementById("spend-site").dispatchEvent(new Event("change")); document.getElementById("spend-site").focus(); window.whale.refresh("all")');
  check('余额更新保留金额面板选择框焦点', await evaluate(manager, 'document.activeElement === document.getElementById("spend-site")'));
  for (const dimensions of [[1100, 790], [820, 600]]) {
    manager.setSize(...dimensions); await delay(80);
    await evaluate(manager, 'document.getElementById("usage-panel").scrollIntoView({block:"start"})');
    check(dimensions[0] + 'px 金额秒表无页面横向溢出', await evaluate(manager, 'document.documentElement.scrollWidth <= innerWidth'));
    await capture(manager, path.join(output, 'spending-' + dimensions[0] + '.png'));
  }
  await evaluate(manager, 'document.getElementById("spend-reset").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "未开始" && !document.getElementById("spend-start").disabled'), '秒表重置');
  check('重置秒表不删除每日历史', await evaluate(manager, 'document.getElementById("spend-time").textContent === "00:00:00" && document.querySelectorAll("#spend-rows tr").length === 3'));
  manager.setSize(1100, 790);
  await evaluate(manager, 'document.getElementById("spend-start").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "计时中" && !document.getElementById("spend-pause").disabled'), '换算前秒表开始');
  await evaluate(manager, 'document.querySelector(".card .card-actions").children[2].click()');
  check('旧站点默认保持原币种且新增显示币种只有美元和人民币', await evaluate(manager, '!document.getElementById("conversion-enabled").checked && document.getElementById("conversion-fields").hidden && [...document.getElementById("conversion-currency").options].map(o => o.value).join(",") === "USD,CNY"'));
  await evaluate(manager, 'document.getElementById("conversion-enabled").checked = true; document.getElementById("conversion-rate").value = "0.2"; document.getElementById("conversion-currency").value = "CNY"; document.getElementById("conversion-enabled").dispatchEvent(new Event("input"))');
  check('金额转换方向、比例和示例明确显示', await evaluate(manager, 'document.getElementById("conversion-preview").textContent.includes("1 USD × 0.2") && document.getElementById("conversion-preview").textContent.includes("¥2.00")'));
  await evaluate(manager, 'document.getElementById("test-site").click()');
  await until(() => evaluate(manager, 'document.getElementById("test-summary").textContent === "连接成功" && !document.getElementById("test-site").disabled'), '换算测试连接');
  check('测试连接同时显示转换值和接口原值', await evaluate(manager, 'document.getElementById("test-details").value.includes("¥11.386") && document.getElementById("test-details").value.includes("US$56.93")'));
  await evaluate(manager, 'document.getElementById("test-close").click(); document.getElementById("conversion-enabled").scrollIntoView({block:"center"})');
  for (const dimensions of [[1100, 790], [820, 600]]) {
    manager.setSize(...dimensions); await delay(80);
    await evaluate(manager, 'document.getElementById("conversion-enabled").scrollIntoView({block:"center"})');
    check(dimensions[0] + 'px 转换设置无表单横向溢出', await evaluate(manager, 'document.querySelector(".form-scroll").scrollWidth <= document.querySelector(".form-scroll").clientWidth'));
    await capture(manager, path.join(output, 'conversion-settings-' + dimensions[0] + '.png'));
  }
  await evaluate(manager, 'document.getElementById("site-form").requestSubmit()');
  await until(() => evaluate(manager, '!document.getElementById("editor").open && document.querySelector(".card .balance").textContent === "¥11.386"'), '保存转换设置');
  check('各站点转换比例独立，另一站余额保持美元', await evaluate(manager, 'document.querySelectorAll(".card .balance")[1].textContent === "US$3.80"'));
  check('换算设置同步每日卡片、明细和运行中秒表', await evaluate(manager, 'document.querySelector(".spend-day-card strong").textContent === "¥0.00" && document.querySelector("#spend-rows").textContent.includes("CNY") && document.getElementById("spend-amount").textContent === "¥0.00" && document.getElementById("spend-status").textContent === "计时中"'));
  await evaluate(manager, 'window.whale.preferences({ bubbleMode: "all", bubbleSeconds: 0, clickSound: false })');
  await evaluate(pet, 'document.getElementById("character").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter"}))');
  await until(() => evaluate(pet, '!document.getElementById("bubble").hidden && document.querySelector("[data-money-site]")?.textContent === "¥11.386"'), '桌宠人民币金额');
  check('桌宠气泡与看板使用相同转换比例', await evaluate(pet, 'document.querySelectorAll("[data-money-site]")[1].textContent === "$3.80"'));
  await capture(pet, path.join(output, 'pet-conversion.png'));
  await evaluate(manager, 'document.querySelector(".card .card-actions").children[2].click()');
  check('转换设置保存后可重新编辑', await evaluate(manager, 'document.getElementById("conversion-enabled").checked && document.getElementById("conversion-rate").value === "0.2" && document.getElementById("conversion-currency").value === "CNY"'));
  await evaluate(manager, 'document.getElementById("conversion-currency").value = "USD"; document.getElementById("conversion-rate").value = "0.1"; document.getElementById("site-form").requestSubmit()');
  await until(() => evaluate(manager, '!document.getElementById("editor").open && document.querySelector(".card .balance").textContent === "US$5.693"'), '切换美元显示');
  check('币种和比例修改不暂停秒表或清空每日历史', await evaluate(manager, 'document.getElementById("spend-status").textContent === "计时中" && document.querySelectorAll("#spend-rows tr").length === 3 && document.getElementById("spend-amount").textContent === "US$0.00"'));
  await evaluate(manager, 'document.getElementById("spend-stop").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "已结束" && !document.getElementById("spend-reset").disabled'), '转换秒表结束');
  await evaluate(manager, 'document.getElementById("spend-reset").click()');
  await until(() => evaluate(manager, 'document.getElementById("spend-status").textContent === "未开始" && !document.getElementById("spend-start").disabled'), '转换秒表重置');
  await evaluate(manager, 'document.querySelector("[data-usage-tab=api]").click()');
  check('API 仪表盘显示每个站点及八项指标', await evaluate(manager, '!document.getElementById("usage-api-view").hidden && document.querySelectorAll("#usage-api-site option").length === 3 && document.querySelectorAll(".api-metric").length === 8'));
  check('缓存命中率按 Token 口径计算', await evaluate(manager, 'document.querySelector("[data-metric=hit-rate] strong").textContent === "46.7%" && Math.abs(document.getElementById("usage-api-cache-bar").value - 7000 / 15000 * 100) < 0.001'));
  check('输入输出趋势及每日明细可查看', await evaluate(manager, '!!document.querySelector("#usage-api-chart svg") && document.querySelectorAll("#usage-api-daily-rows tr").length === 30 && document.querySelector("#usage-api-chart .api-chart-input") && !!document.querySelector("#usage-api-chart .api-chart-output") ? true : false'));
  for (const dimensions of [[1100, 790], [820, 600]]) {
    manager.setSize(...dimensions); await delay(80);
    await evaluate(manager, 'document.querySelector(".api-daily").open = true; document.getElementById("usage-panel").scrollIntoView({block:"start"})');
    check(dimensions[0] + 'px API 仪表盘无页面横向溢出', await evaluate(manager, 'document.documentElement.scrollWidth <= innerWidth'));
    await capture(manager, path.join(output, 'api-dashboard-' + dimensions[0] + '.png'));
  }
  await evaluate(manager, 'globalThis.qaApiSelect = document.getElementById("usage-api-site"); qaApiSelect.value = qaApiSelect.options[1].value; qaApiSelect.dispatchEvent(new Event("change"))');
  check('未支持的 API 不显示虚构的零用量或缓存率', await evaluate(manager, '[...document.querySelectorAll(".api-metric strong")].every(e => e.textContent === "—") && document.getElementById("usage-api-cache-bar").hidden && !!document.querySelector(".api-chart-empty")'));
  await evaluate(manager, 'qaApiSelect.focus(); document.getElementById("usage-refresh").onclick()');
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), 'API 仪表盘刷新');
  check('刷新保留所选 API 与选择框焦点', await evaluate(manager, 'qaApiSelect.value === qaApiSelect.options[1].value && document.activeElement === qaApiSelect && document.querySelector("[data-metric=total] strong").textContent === "—"'));
  await evaluate(manager, `qaApiSelect.value = qaApiSelect.options[0].value; qaApiSelect.dispatchEvent(new Event('change')); document.querySelector('[data-usage-range="7"]').click()`);
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '7 天 API 数据');
  check('时间范围同步到 API 指标与每日明细', await evaluate(manager, 'document.querySelectorAll("#usage-api-daily-rows tr").length === 7 && document.querySelector("[data-metric=requests] strong").textContent === "148"'));
  await evaluate(manager, 'document.querySelector("[data-usage-range=all]").click()');
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '累计 API 数据');
  check('累计指标和 90 天趋势明确区分', await evaluate(manager, 'document.querySelector("[data-metric=requests] strong").textContent === "18,020" && document.querySelectorAll("#usage-api-daily-rows tr").length === 90 && document.getElementById("usage-api-trend-note").textContent.includes("近 90 天")'));
  await evaluate(manager, `globalThis.qaApiFixture = document.createElement('section'); qaApiFixture.hidden = true; qaApiFixture.innerHTML = '<div class="usage-footbar"></div>'; document.body.append(qaApiFixture); globalThis.qaApiRenderer = window.APIDashboard.create(qaApiFixture); globalThis.qaApiPeriod = { range: '7', days: 7, start: '2026-09-28', end: '2026-10-04' }; globalThis.qaZero = { requests: 0, total_tokens: 0, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }; qaApiRenderer.render({ period: qaApiPeriod, checkedAt: Date.now(), rows: [{ id: 'zero', name: '零用量', status: 'ok', metrics: qaZero, daily: [] }] })`);
  check('零用量显示零而缓存率及每请求平均值留空', await evaluate(manager, 'qaApiFixture.querySelector("[data-metric=total] strong").textContent === "0" && qaApiFixture.querySelector("[data-metric=hit-rate] strong").textContent === "—" && qaApiFixture.querySelector("[data-metric=average] strong").textContent === "—"'));
  await evaluate(manager, `qaApiRenderer.render({ period: qaApiPeriod, checkedAt: Date.now(), rows: [{ id: 'zero', name: '失败 API', status: 'error', error: '连接超时', metrics: qaZero, daily: [] }] })`);
  check('API 查询失败不沿用旧统计', await evaluate(manager, '[...qaApiFixture.querySelectorAll(".api-metric strong")].every(e => e.textContent === "—") && qaApiFixture.querySelector("#usage-api-status").textContent.includes("连接超时")'));
  await evaluate(manager, `qaApiRenderer.render({ period: qaApiPeriod, checkedAt: Date.now(), rows: [{ id: 'first', name: '原 API', status: 'ok', metrics: { ...qaZero, requests: 2, total_tokens: 1200, input_tokens: 100, output_tokens: 1000, cache_creation_tokens: 20, cache_read_tokens: 80 }, daily: [] }, { id: 'copy', name: '重复 API', status: 'duplicate', duplicateOf: 'first', error: '相同站点和 Key，已并入原 API' }] }); const qaSelect = qaApiFixture.querySelector('#usage-api-site'); qaSelect.value = 'copy'; qaSelect.dispatchEvent(new Event('change'))`);
  check('重复 Key 可查看同一来源但不重复计入汇总', await evaluate(manager, 'qaApiFixture.querySelector("#usage-api-view").dataset.sourceId === "first" && qaApiFixture.querySelector("[data-metric=hit-rate] strong").textContent === "40.0%" && qaApiFixture.querySelector("#usage-api-status").textContent.includes("共享同一 Key")'));
  await evaluate(manager, 'qaApiFixture.remove()');
  await evaluate(manager, `document.querySelector('.api-daily').open = false; document.querySelector('[data-usage-range="30"]').click()`);
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '恢复 30 天范围');
  await evaluate(manager, 'document.querySelector("[data-usage-tab=overview]").click(); window.scrollTo(0, 0)');
  await evaluate(manager, `globalThis.qaCard = document.querySelector('.card'); globalThis.qaOther = document.querySelectorAll('.card')[1]; globalThis.qaSettings = qaCard.querySelectorAll('.card-actions button')[2]; qaSettings.focus(); window.whale.refresh('all')`);
  check('余额刷新保留卡片、按钮与键盘焦点', await evaluate(manager, 'qaCard === document.querySelector(".card") && qaOther === document.querySelectorAll(".card")[1] && qaSettings === qaCard.querySelectorAll("button")[2] && document.activeElement === qaSettings'));
  await evaluate(manager, 'globalThis.qaRefresh = qaCard.querySelectorAll("button")[1]; qaRefresh.focus(); qaRefresh.click()');
  await until(() => evaluate(manager, 'qaRefresh.getAttribute("aria-disabled") !== "true" && qaRefresh.textContent === "刷新"'), '单站查询');
  check('手动单站刷新后保留按钮焦点', await evaluate(manager, 'document.activeElement === qaRefresh'));
  await evaluate(manager, 'qaSettings.focus()');
  await evaluate(manager, 'window.whale.select(qaOther.dataset.siteId)');
  check('切换查看站点保留焦点与按钮', await evaluate(manager, 'document.activeElement === qaSettings && qaOther.classList.contains("selected") && qaOther.querySelector("button").textContent === "当前查看站点"'));
  await evaluate(manager, 'qaSettings.click()');
  await until(() => evaluate(manager, 'document.getElementById("editor").open'), '编辑窗口');
  await evaluate(manager, 'document.getElementById("name").value = "已更新演示站点"; document.getElementById("enabled").checked = false; window.whale.refresh("all")');
  check('查询期间保留未保存的表单输入', await evaluate(manager, 'document.getElementById("name").value === "已更新演示站点" && !document.getElementById("enabled").checked'));
  await evaluate(manager, 'document.getElementById("site-form").requestSubmit()');
  await until(() => evaluate(manager, '!document.getElementById("editor").open && qaCard.querySelector("h2").textContent === "已更新演示站点" && document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '保存更新');
  await evaluate(manager, 'qaSettings.click()');
  check('保留的设置按钮读取最新配置', await evaluate(manager, 'document.getElementById("name").value === "已更新演示站点" && !document.getElementById("enabled").checked'));
  await evaluate(manager, 'document.getElementById("cancel-editor").click()');
  check('关闭编辑窗口恢复原按钮焦点', await evaluate(manager, 'document.activeElement === qaSettings'));
  await evaluate(manager, `const cells = document.querySelectorAll('.usage-heat-cell'); globalThis.qaDate = cells[160].dataset.date; cells.forEach(c => c.tabIndex = -1); cells[160].tabIndex = 0; cells[160].focus(); document.getElementById('usage-refresh').onclick()`);
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '用量刷新');
  check('用量刷新保留日期焦点与唯一 Tab 入口', await evaluate(manager, 'document.activeElement.dataset.date === qaDate && [...document.querySelectorAll(".usage-heat-cell")].filter(c => c.tabIndex === 0).length === 1 && !document.getElementById("usage-day-tooltip").hidden'));
  await evaluate(manager, 'document.getElementById("add-site").focus(); document.getElementById("usage-refresh").onclick()');
  check('后台用量更新不抢走其他控件焦点', await evaluate(manager, 'document.activeElement === document.getElementById("add-site")'));
  for (const dimensions of [[1100, 790], [820, 600]]) {
    manager.setSize(...dimensions); await delay(80);
    check(dimensions[0] + 'px 无页面横向溢出', await evaluate(manager, 'document.documentElement.scrollWidth <= innerWidth'));
    await capture(manager, path.join(output, 'manager-' + dimensions[0] + '.png'));
    await evaluate(manager, 'qaCard.scrollIntoView({ block: "start" })');
    await capture(manager, path.join(output, 'cards-' + dimensions[0] + '.png'));
    await evaluate(manager, 'window.scrollTo(0, 0)');
  }
  await evaluate(manager, 'window.whale.preferences({ skin: "white", clickSound: false })');
  await until(() => evaluate(pet, 'document.querySelector("#character-art").src.includes("white") && document.querySelector("#character-art").complete && document.querySelector("#character-art").naturalWidth > 0'), '皮肤切换');
  check('现有桌宠仍可切换皮肤', await evaluate(pet, 'document.getElementById("character-art").naturalWidth > 0'));
  await capture(pet, path.join(output, 'pet.png'));
  await evaluate(manager, `qaCard.querySelectorAll('.card-actions button')[3].click(); document.getElementById('confirm-delete').click()`);
  await until(() => evaluate(manager, 'document.querySelectorAll(".card").length === 2 && !document.getElementById("delete-dialog").open'), '删除站点');
  check('删除后保留其他站点卡片', await evaluate(manager, 'qaOther.isConnected && document.querySelectorAll(".card").length === 2'));
  await evaluate(manager, `(async () => { for (const c of [...document.querySelectorAll('.card')]) await window.whale.remove(c.dataset.siteId); })()`);
  await until(() => evaluate(manager, 'document.querySelectorAll(".card").length === 0'), '清空演示站点');
  check('最后一个站点删除后显示添加入口', await evaluate(manager, '!document.getElementById("empty").hidden'));
  check('空站点时消费秒表禁用，金额历史不残留', await evaluate(manager, 'document.getElementById("spend-start").disabled && document.getElementById("spend-timer-site").disabled && !document.querySelectorAll(".spend-day-card").length && document.getElementById("spend-rows").textContent.includes("暂无金额记录")'));
  await until(() => evaluate(manager, 'document.getElementById("usage-panel").getAttribute("aria-busy") === "false"'), '空站点仪表盘');
  check('删除所有站点后仪表盘清除旧统计', await evaluate(manager, 'document.getElementById("usage-api-site").disabled && !document.querySelectorAll("#usage-api-site option").length && [...document.querySelectorAll(".api-metric strong")].every(e => e.textContent === "—")'));
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: true, externalBrowser: false, version: require('../package.json').version, checks, errors }, null, 2));
  console.log('PASS Electron 自身界面验证：' + checks.length + ' 项；输出 ' + output);
  app.quit();
}
run().catch(error => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: false, checks, errors, error: error.stack }, null, 2));
  console.error(error); app.exit(1);
});
