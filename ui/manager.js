'use strict';
const $ = id => document.getElementById(id); const V = window.View;
let state, editing = null, deleting = null, busy = false;
const cardViews = new Map();
let testTimer, testDismissed = false, testText = '', copyRevision = 0;
function hideTestResult() { clearTimeout(testTimer); testDismissed = true; const notice = $('test-result'), hadFocus = notice.contains(document.activeElement); if (notice.matches(':popover-open')) notice.hidePopover(); notice.hidden = true; if (hadFocus && $('editor').open) $('test-site').focus({ preventScroll: true }); }
function showTestResult(summary, details, status) {
  if (testDismissed) return;
  clearTimeout(testTimer); copyRevision++;
  const notice = $('test-result'); notice.dataset.status = status;
  $('test-summary').textContent = summary;
  $('test-summary').setAttribute('role', status === 'fail' ? 'alert' : 'status');
  $('test-details').value = details; $('test-details').rows = Math.min(12, Math.max(3, details.split('\n').length));
  $('test-details').scrollTop = 0;
  $('test-copy').textContent = '复制全部'; $('test-copy').disabled = status === 'pending';
  $('test-expiry').textContent = status === 'pending' ? '查询中' : '60 秒后自动关闭';
  testText = summary + '\n' + details;
  notice.hidden = false; if (!notice.matches(':popover-open')) notice.showPopover();
  if (status !== 'pending') { testTimer = setTimeout(hideTestResult, 60000); $('test-summary').focus({ preventScroll: true }); }
}
$('test-close').onclick = hideTestResult;
$('test-copy').onclick = async () => {
  const revision = copyRevision;
  try { await window.whale.copyTestResult(testText); if (revision === copyRevision) $('test-copy').textContent = '已复制'; }
  catch { $('test-details').focus(); $('test-details').select(); if (revision === copyRevision) $('test-copy').textContent = '请按 Ctrl+C 复制'; }
};
$('test-result').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideTestResult(); } });
const providerNames = { sub2api: 'Sub2API', billing: 'Billing', newapi: 'New API', deepseek: 'DeepSeek', openrouter: 'OpenRouter', moonshot: 'Moonshot', custom: '自定义 JSON' };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
function button(text, action, cls = '') {
  const b = V.el('button', cls, text); b.type = 'button'; let pending = false;
  b.addEventListener('click', async () => {
    if (pending) return;
    pending = true; b.setAttribute('aria-disabled', 'true');
    try { await action(); } catch (e) { toast(e.message); }
    finally { pending = false; b.setAttribute('aria-disabled', 'false'); }
  });
  return b;
}
function createCard(id) {
  const card = V.el('article', 'card'); card.dataset.siteId = id;
  const mark = V.el('div', 'site-mark'), name = V.el('h2'), host = V.el('div', 'host'), status = V.el('span', 'status-tag');
  name.id = 'site-title-' + id; card.setAttribute('aria-labelledby', name.id);
  const top = V.el('div', 'card-top'), title = V.el('div', 'card-title'); title.append(name, host); top.append(mark, title, status);
  const label = V.el('div', 'amount-label'), balance = V.el('div', 'balance'), stale = V.el('div', 'stale-note', '上次成功值 · 当前未确认');
  const windows = V.el('div', 'windows'), metrics = V.el('div', 'metric-line'), updated = V.el('span'), decrease = V.el('span'), error = V.el('div', 'error-note'); metrics.append(updated, decrease);
  const select = button('设为查看站点', () => window.whale.select(id));
  const refresh = button('刷新', () => window.whale.refresh(id));
  const settings = button('设置', () => { const p = state.sites.find(site => site.id === id); if (p) openEditor(p); });
  const remove = button('删除', () => {
    const p = state.sites.find(site => site.id === id); if (!p) return;
    deleting = id; $('delete-text').textContent = `将移除“${p.name}”的本机设置、加密 Key 和观测记录。`; $('delete-dialog').showModal();
  }, 'delete');
  const actions = V.el('div', 'card-actions'); actions.append(select, refresh, settings, remove);
  card.append(top, label, balance, stale, windows, metrics, error, actions);
  return { card, mark, name, host, status, label, balance, stale, windows, updated, decrease, error, select, refresh, settings, remove };
}
function updateCard(view, p, st, s) {
  const signature = JSON.stringify([p, st, s.selected === p.id, s.preferences.bubbleMode]);
  if (view.signature === signature) return;
  view.signature = signature;
  const r = V.result(st), stale = st.status !== 'ok', low = !stale && p.alert && r?.amount != null && r.amount <= p.threshold;
  const shown = V.convertedResult(r, p);
  view.card.className = 'card' + (s.selected === p.id ? ' selected' : '') + (low ? ' low' : '');
  view.mark.textContent = p.name.slice(0, 2).toUpperCase(); view.name.textContent = p.name;
  view.host.textContent = new URL(p.baseUrl).host + ' / ' + providerNames[p.provider]; view.host.title = view.host.textContent;
  view.status.className = 'status-tag ' + (!p.enabled ? 'paused' : st.status); view.status.textContent = V.status(st, p);
  view.label.textContent = (V.kind[r?.kind] || '可用金额') + (shown?.currency ? ' · ' + shown.currency : '') + (p.moneyConversion?.enabled ? ' · 已换算' : '');
  view.balance.className = 'balance' + (low ? ' low' : '') + (stale ? ' stale' : ''); view.balance.textContent = V.amount(r, p);
  view.balance.title = V.conversionNote(r?.currency || p.currency, p) + (p.moneyConversion?.enabled ? '；接口原值 ' + V.money(r?.amount, r?.currency) : '');
  view.stale.hidden = !(stale && r); view.windows.hidden = !r?.windows?.length;
  view.windows.replaceChildren(...(shown?.windows || []).map(w => V.el('div', 'window', `${w.label}：${V.money(w.used, shown.currency)} / ${V.money(w.limit, shown.currency)}`)));
  view.updated.textContent = '更新 ' + V.time(st.updatedAt || st.cachedAt);
  const todayRows = s.spending?.history.filter(d => d.siteId === p.id && d.date === s.spending.day && d.currency === r?.currency && d.kind === r?.kind);
  const decrease = V.convert(todayRows?.length ? todayRows.reduce((n, d) => n + d.amount, 0) : st.decrease || 0, r?.currency || p.currency, p);
  view.decrease.textContent = '今日观测下降 ' + V.money(decrease.amount, decrease.currency);
  view.error.hidden = !st.error; view.error.textContent = st.error || '';
  view.select.textContent = s.selected === p.id && s.preferences.bubbleMode === 'selected' ? '当前查看站点' : '设为查看站点';
  view.refresh.textContent = st.status === 'loading' ? '查询中…' : '刷新';
  view.refresh.setAttribute('aria-busy', String(st.status === 'loading'));
  for (const [b, action] of [[view.select, '查看'], [view.refresh, '刷新'], [view.settings, '设置'], [view.remove, '删除']]) b.setAttribute('aria-label', action + '“' + p.name + '”');
}
function render(s) {
  state = s; $('demo-banner').hidden = !s.demo; $('nav-count').textContent = s.sites.length;
  $('pinned').checked = s.preferences.pinned; $('snap').checked = s.preferences.snap; $('pet-size').value = s.preferences.petSize;
  $('bubble-mode').value = s.preferences.bubbleMode; $('bubble-seconds').value = s.preferences.bubbleSeconds;
  $('click-sound').checked = s.preferences.clickSound; $('click-volume').value = s.preferences.clickVolume; $('volume-label').textContent = s.preferences.clickVolume + '%';
  if (!$('pet-skin').options.length) for (const [id, skin] of Object.entries(s.skins)) { const option = V.el('option', '', skin.name); option.value = id; $('pet-skin').append(option); }
  $('pet-skin').value = s.preferences.skin;
  const skin = s.skins[s.preferences.skin] || s.skins.default, preview = $('skin-preview-art'), d = skin.draw;
  preview.src = '../assets/' + skin.file; preview.alt = skin.name; preview.style.width = d.width * 100 + '%'; preview.style.height = d.height * 100 + '%'; preview.style.left = d.left * 100 + '%'; preview.style.top = d.top * 100 + '%';
  const live = s.sites.filter(p => p.enabled).length; const errors = s.sites.filter(p => s.states[p.id]?.status === 'error').length;
  $('overview').textContent = `${s.sites.length} 个站点 · ${live} 个自动刷新${errors ? ` · ${errors} 个查询失败` : ''}`;
  $('empty').hidden = !!s.sites.length;
  const ids = new Set(s.sites.map(p => p.id));
  let lostFocus = false;
  for (const [id, view] of cardViews) if (!ids.has(id)) { lostFocus ||= view.card.contains(document.activeElement); view.card.remove(); cardViews.delete(id); }
  let index = 0;
  for (const p of s.sites) {
    let view = cardViews.get(p.id);
    if (!view) { view = createCard(p.id); cardViews.set(p.id, view); }
    updateCard(view, p, s.states[p.id] || { status: 'waiting' }, s);
    const at = $('cards').children[index++]; if (at !== view.card) $('cards').insertBefore(view.card, at || null);
  }
  if (lostFocus) (cardViews.values().next().value?.settings || $('add-site')).focus({ preventScroll: true });
}
function providerChanged() {
  const p = $('provider').value; $('custom-fields').hidden = p !== 'custom'; $('billing-row').hidden = p !== 'billing'; $('quota-row').hidden = p !== 'newapi';
  $('provider-hint').textContent = ({ sub2api: '/v1/usage 会区分钱包余额、Key 额度和订阅窗口。不同中转站不保证使用相同接口，请先测试。', billing: '读取 subscription 和 usage 双接口，计算账单剩余额度。部分中转站已经关闭这些旧接口。', newapi: '查询的是此 API Key 的剩余额度，可能与账户钱包不同。原始 quota 需按服务商倍率换算。', deepseek: '使用官方余额接口，可根据返回数据区分人民币与美元。', openrouter: '使用官方 credits 接口，需要 OpenRouter 管理 Key；普通推理 Key 可能返回 403。', moonshot: '使用 available_balance 字段。请按照此站点实际计价设置币种。', custom: '按服务商说明填写查询接口和余额字段。POST 仅用于服务商的只读余额查询接口。' })[p];
  $('header-row').hidden = $('auth').value !== 'header'; $('body-row').hidden = $('method').value !== 'POST';
}
function openEditor(p) {
  editing = p?.id || null; $('site-form').reset(); $('preset').value = 'manual'; $('editor-title').textContent = p ? '编辑站点' : '添加站点';
  const defaults = { name: '', provider: 'sub2api', baseUrl: '', currency: 'USD', interval: 60, threshold: 5, billingDivisor: 100, quotaPerUnit: 500000 };
  for (const [k, v] of Object.entries(defaults)) $(k).value = p?.[k] ?? v;
  const conversion = p?.moneyConversion || { enabled: false, rate: 1, currency: 'USD' };
  $('conversion-enabled').checked = conversion.enabled; $('conversion-rate').value = conversion.rate; $('conversion-currency').value = conversion.currency;
  $('key').value = ''; $('key').placeholder = p?.hasKey ? '已保存；留空沿用，填写则替换' : '粘贴该站点的 API Key';
  $('key-note').textContent = p?.hasKey ? '已保存的 Key 不回显。更换域名时必须填写新站点 Key。' : '每个站点使用自己的 Key。界面不会回显已保存的 Key。';
  $('alert').checked = p?.alert !== false; $('enabled').checked = p?.enabled !== false;
  const c = p?.custom || { path: '/v1/usage', method: 'GET', auth: 'bearer', header: 'x-api-key', balanceField: 'balance', usedField: '', scale: 1, kind: 'wallet', body: '' };
  for (const k of ['path', 'method', 'auth', 'balanceField', 'usedField', 'scale', 'kind', 'body']) $(k).value = c[k]; $('auth-header').value = c.header;
  $('form-error').textContent = ''; hideTestResult(); providerChanged(); conversionChanged(); $('editor').showModal(); document.querySelector('.form-scroll').scrollTop = 0;
}
function input() {
  const p = { ...(editing ? { id: editing } : {}), key: $('key').value, alert: $('alert').checked, enabled: $('enabled').checked };
  for (const k of ['name', 'provider', 'baseUrl', 'currency', 'interval', 'threshold', 'billingDivisor', 'quotaPerUnit']) p[k] = $(k).value;
  const conversionEnabled = $('conversion-enabled').checked, rate = Number($('conversion-rate').value);
  p.moneyConversion = { enabled: conversionEnabled, rate: conversionEnabled || Number.isFinite(rate) && rate >= 1e-9 && rate <= 1e9 ? rate : 1, currency: $('conversion-currency').value };
  p.custom = {}; for (const k of ['path', 'method', 'auth', 'balanceField', 'usedField', 'scale', 'kind', 'body']) p.custom[k] = $(k).value; p.custom.header = $('auth-header').value;
  return p;
}
function closeEditor() { if (busy) return; hideTestResult(); $('key').value = ''; $('editor').close(); }
function lock(value) { busy = value; for (const id of ['test-site', 'save-site', 'cancel-editor', 'close-editor']) $(id).disabled = value; }
$('site-form').addEventListener('submit', async e => { e.preventDefault(); lock(true); $('form-error').textContent = ''; try { await window.whale.save(input()); lock(false); closeEditor(); toast('站点已保存，正在查询余额'); } catch (e) { $('form-error').textContent = e.message; } finally { lock(false); } });
$('test-site').addEventListener('click', async () => {
  testDismissed = false;
  if (!$('site-form').reportValidity()) {
    const field = $('site-form').querySelector(':invalid');
    showTestResult('设置不完整：' + (field?.validationMessage || '请检查输入'), JSON.stringify({ code: 'CONFIG', field: field?.id }, null, 2), 'fail'); return;
  }
  lock(true); $('form-error').textContent = '';
  showTestResult('正在测试连接…', '正在查询余额，请稍候。', 'pending');
  try {
    const response = await window.whale.test(input());
    if (!response.ok) { showTestResult(response.error, JSON.stringify({ code: response.code || 'UNKNOWN', ...response.details }, null, 2), 'fail'); return; }
    const r = response.value;
    const draft = input(), shown = V.convertedResult(r, draft);
    const details = `${V.kind[r.kind]}：${V.amount(r, draft)}${shown.windows.length ? '\n' + shown.windows.map(w => `${w.label}：${V.money(w.used, shown.currency)} / ${V.money(w.limit, shown.currency)}`).join('\n') : ''}\n${V.conversionNote(r.currency, draft)}${draft.moneyConversion.enabled ? '\n接口原值：' + V.amount(r) : ''}\n${state.demo ? '演示返回，未连接真实站点。' : '已完成余额查询，设置尚未保存。'}`;
    showTestResult('连接成功', details, 'success');
  } catch (e) {
    showTestResult(e.message, JSON.stringify({ code: e.code || 'UNKNOWN', ...e.details }, null, 2), 'fail');
  } finally { lock(false); }
});
for (const id of ['add-site', 'empty-add']) $(id).onclick = () => openEditor();
for (const id of ['close-editor', 'cancel-editor']) $(id).onclick = closeEditor;
$('editor').addEventListener('cancel', e => { if ($('test-result').matches(':popover-open')) { e.preventDefault(); hideTestResult(); } else if (busy) e.preventDefault(); else { hideTestResult(); $('key').value = ''; } });
function conversionChanged() {
  const enabled = $('conversion-enabled').checked;
  $('conversion-fields').hidden = !enabled; $('conversion-rate').disabled = !enabled; $('conversion-currency').disabled = !enabled;
  const raw = state?.sites.find(p => p.id === editing), currency = raw ? V.result(state.states[raw.id] || {})?.currency || $('currency').value : $('currency').value;
  const rate = Number($('conversion-rate').value), target = $('conversion-currency').value;
  $('conversion-preview').textContent = Number.isFinite(rate) && rate > 0 ? `1 ${currency} × ${rate} = ${rate} ${target}；接口金额 10 将显示为 ${V.money(10 * rate, target)}。` : '请输入大于 0 的转换比例。';
}
for (const id of ['conversion-enabled', 'conversion-rate', 'conversion-currency', 'currency']) $(id).addEventListener('input', conversionChanged);
$('provider').onchange = providerChanged; $('auth').onchange = providerChanged; $('method').onchange = providerChanged;
$('preset').onchange = () => { const presets = { bb: ['BB API', 'sub2api', 'https://www.bb-api.com', 'USD'], deepseek: ['DeepSeek', 'deepseek', 'https://api.deepseek.com', 'CNY'], openrouter: ['OpenRouter', 'openrouter', 'https://openrouter.ai', 'USD'], moonshot: ['Moonshot', 'moonshot', 'https://api.moonshot.cn', 'CNY'] }; const values = presets[$('preset').value]; if (values) ['name', 'provider', 'baseUrl', 'currency'].forEach((k, i) => $(k).value = values[i]); providerChanged(); };
$('refresh-all').onclick = async () => { $('refresh-all').disabled = true; try { await window.whale.refresh('all'); toast('本轮查询已完成'); } catch (e) { toast(e.message); } finally { $('refresh-all').disabled = false; } };
$('show-pet').onclick = () => window.whale.show().catch(e => toast(e.message));
$('hide-pet').onclick = () => window.whale.hide().catch(e => toast(e.message));
for (const id of ['pinned', 'snap', 'pet-size']) $(id).onchange = () => window.whale.preferences({ pinned: $('pinned').checked, snap: $('snap').checked, petSize: Number($('pet-size').value) }).catch(e => toast(e.message));
for (const id of ['bubble-mode', 'bubble-seconds']) $(id).onchange = () => window.whale.preferences({ bubbleMode: $('bubble-mode').value, bubbleSeconds: Number($('bubble-seconds').value) }).catch(e => toast(e.message));
$('click-sound').onchange = () => window.whale.preferences({ clickSound: $('click-sound').checked }).catch(e => toast(e.message));
$('pet-skin').onchange = () => window.whale.preferences({ skin: $('pet-skin').value }).catch(e => toast(e.message));
$('click-volume').oninput = () => $('volume-label').textContent = $('click-volume').value + '%';
$('click-volume').onchange = () => window.whale.preferences({ clickVolume: Number($('click-volume').value) }).catch(e => toast(e.message));
$('cancel-delete').onclick = () => $('delete-dialog').close(); $('confirm-delete').onclick = async () => { try { await window.whale.remove(deleting); $('delete-dialog').close(); toast('站点已删除'); } catch (e) { toast(e.message); } };
window.whale.onState(render); window.whale.state().then(render).catch(e => toast(e.message));

