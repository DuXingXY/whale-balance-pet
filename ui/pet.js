'use strict';
const $ = id => document.getElementById(id), V = window.View;
let state, visible = false, refreshing = false, manualError = '', pointer = null, dismissTimer, pressAnimation;
let characterPixels = null, bubblePixels = null, bubbleMask = null, mouse = null, ignoring = false, lastClick = -Infinity;
let currentSkin = '', skinGeneration = 0;
let turnAnimation = null, turnFrom = 0, turnTo = 0, turnFrame;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function turnAngle() {
  const progress = turnAnimation?.effect.getComputedTiming().progress;
  return progress == null ? turnTo : turnFrom + (turnTo - turnFrom) * progress;
}
function updateFacing(facing) {
  const character = $('character'), previous = character.dataset.facing;
  if (previous === facing) return;
  const start = turnAngle(), end = facing === 'right' ? 180 : 0;
  turnAnimation?.cancel(); cancelAnimationFrame(turnFrame); turnAnimation = null;
  character.dataset.facing = facing; turnFrom = start; turnTo = end;
  // Initial placement is immediate. Later turns rotate the same paper-like
  // surface through its thin edge; click feedback stays on the outer frame.
  if (!previous || reducedMotion.matches || Math.abs(end - start) < .1) return;
  const animation = $('character-visual').animate([
    { transform: `rotateY(${start}deg)` },
    { transform: `rotateY(${end}deg)` },
  ], { duration: 400 * Math.abs(end - start) / 180, easing: 'ease-in-out' });
  turnAnimation = animation;
  function trackTurn() {
    if (turnAnimation !== animation) return;
    updateMouseHandling(); turnFrame = requestAnimationFrame(trackTurn);
  }
  turnFrame = requestAnimationFrame(trackTurn);
  animation.finished.then(() => {
    if (turnAnimation !== animation) return;
    turnAnimation = null; cancelAnimationFrame(turnFrame); updateMouseHandling();
  }).catch(() => {});
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    turnAnimation?.cancel(); turnAnimation = null; cancelAnimationFrame(turnFrame); updateMouseHandling();
  }
});
const knownBalances = new Map(), deductions = new Map();
const deductionLayer = V.el('div', 'deduction-layer');
deductionLayer.setAttribute('aria-hidden', 'true'); $('bubble').append(deductionLayer);
function clearDeduction(id) {
  const item = deductions.get(id); if (!item) return;
  deductions.delete(id); item.animation.cancel(); item.node.remove();
}
function positionDeductions() {
  const bubble = $('bubble').getBoundingClientRect();
  for (const [id, item] of deductions) {
    const money = [...$('content').querySelectorAll('[data-money-site]')].find(el => el.dataset.moneySite === id);
    if (!money) { clearDeduction(id); continue; }
    const range = document.createRange(); range.selectNodeContents(money); const rect = range.getBoundingClientRect();
    item.node.style.left = Math.min(278, rect.right - bubble.left) + 'px';
    item.node.style.top = rect.bottom - bubble.top - 2 + 'px';
    item.node.classList.toggle('multiple', $('bubble').classList.contains('multiple'));
    // Rows outside the scroll viewport must not leave detached floating labels.
    const content = $('content').getBoundingClientRect(); item.node.hidden = rect.bottom > content.bottom + 1 || rect.top < content.top - 1;
  }
}
function animateDeduction(id, amount, currency) {
  clearDeduction(id);
  const text = new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(amount);
  const node = V.el('div', 'balance-deduction', '−' + (currency === 'USD' ? text.replace(/^US(?=\$)/, '') : text));
  node.dataset.siteId = id; deductionLayer.append(node);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = node.animate([
    { transform: 'translate(-100%, 0)', opacity: 1, offset: 0 },
    { transform: `translate(-100%, ${reduced ? 0 : 12}px)`, opacity: 1, offset: .35 },
    { transform: `translate(-100%, ${reduced ? 0 : 32}px)`, opacity: 0, offset: 1 },
  ], { duration: 3400, easing: 'ease-out', fill: 'forwards' });
  deductions.set(id, { node, animation });
  animation.finished.then(() => { if (deductions.get(id)?.node === node) { deductions.delete(id); node.remove(); } }).catch(() => {});
}
function observeBalances(s) {
  const changes = [], ids = new Set(s.sites.map(p => p.id));
  for (const id of knownBalances.keys()) if (!ids.has(id)) { knownBalances.delete(id); clearDeduction(id); }
  for (const p of s.sites) {
    const st = s.states[p.id], result = st?.status === 'ok' ? st.snapshot : st?.cached, previous = knownBalances.get(p.id);
    if (previous && previous.revision !== p.revision) { knownBalances.delete(p.id); clearDeduction(p.id); }
    if (!result || typeof result.amount !== 'number' || !Number.isFinite(result.amount) || result.unlimited) { if (st?.status === 'ok') { knownBalances.delete(p.id); clearDeduction(p.id); } continue; }
    const current = { amount: result.amount, currency: result.currency, kind: result.kind, revision: p.revision };
    const old = knownBalances.get(p.id);
    if (st.status === 'ok') {
      if (old && old.currency === current.currency && old.kind === current.kind) {
        const decrease = Math.round((old.amount - current.amount) * 1e8) / 1e8;
        if (decrease > 0) { const shown = V.convert(decrease, current.currency, p); if (shown.amount != null) changes.push({ id: p.id, amount: shown.amount, currency: shown.currency }); }
        else if (decrease < 0) clearDeduction(p.id);
      } else if (old) clearDeduction(p.id);
      knownBalances.set(p.id, current);
    } else if (!old) knownBalances.set(p.id, current);
    if (st.status === 'error') clearDeduction(p.id);
  }
  return changes;
}
function inside(r, x, y) { return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }
function imagePixels(image) {
  try { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0); return { pixels: context.getImageData(0, 0, canvas.width, canvas.height), context }; } catch { return null; }
}
function hitImage(image, cache, x, y, mask, mirrored = false) {
  const r = image.getBoundingClientRect(); if (!inside(r, x, y)) return false;
  const nx = mirrored ? (r.right - x) / r.width : (x - r.left) / r.width, ny = (y - r.top) / r.height;
  if (cache && mask && !cache.context.isPointInPath(mask, nx, ny)) return false;
  if (!cache) return true;
  const p = cache.pixels, px = Math.min(p.width - 1, Math.floor(nx * p.width)), py = Math.min(p.height - 1, Math.floor(ny * p.height));
  return p.data[(py * p.width + px) * 4 + 3] > 35;
}
function updateMouseHandling() {
  if (!mouse) return;
  const { x, y } = mouse;
  const hit = !!pointer || (visible && hitImage($('bubble-art'), bubblePixels, x, y, bubbleMask)) || (inside($('character').getBoundingClientRect(), x, y) && hitImage($('character-art'), characterPixels, x, y, null, Math.cos(turnAngle() * Math.PI / 180) < 0));
  const next = !hit; if (next !== ignoring) { ignoring = next; window.whale.passThrough(next); }
}
function loadCharacter() { characterPixels = imagePixels($('character-art')); updateMouseHandling(); }
async function applySkin(s) {
  const id = Object.hasOwn(s.skins, s.preferences.skin) ? s.preferences.skin : 'default';
  if (id === currentSkin) return;
  currentSkin = id; const generation = ++skinGeneration, skin = s.skins[id], candidate = new Image();
  candidate.src = new URL('../assets/' + skin.file, location.href).href;
  try {
    await candidate.decode(); if (generation !== skinGeneration) return;
    const image = $('character-art'), d = skin.draw; pressAnimation?.cancel();
    image.style.width = d.width * 100 + '%'; image.style.height = d.height * 100 + '%'; image.style.left = d.left * 100 + '%'; image.style.top = d.top * 100 + '%';
    characterPixels = imagePixels(candidate); image.src = candidate.src;
    $('character').setAttribute('aria-label', skin.name + '，点击刷新并查看余额'); $('character').dataset.skin = id;
    requestAnimationFrame(updateMouseHandling);
  } catch {
    if (generation !== skinGeneration) return;
    currentSkin = ''; if (id !== 'default') applySkin({ ...s, preferences: { ...s.preferences, skin: 'default' } });
  }
}
function applyLayout(layout) {
  if (!layout) return;
  const image = $('character'); image.style.left = layout.character.x + 'px'; image.style.top = layout.character.y + 'px'; image.style.bottom = 'auto';
  updateFacing(layout.facing || 'left');
  image.style.transformOrigin = layout.origin.x + ' ' + layout.origin.y;
  $('bubble').style.left = (layout.bubble.left ?? 0) + 'px'; $('bubble').style.top = layout.bubble.top + 'px'; $('bubble').classList.toggle('below', layout.bubble.below);
  updateMouseHandling();
}
function loadBubble() {
  bubblePixels = imagePixels($('bubble-art'));
  const clip = document.getElementById('bubble-ink'); bubbleMask = new Path2D(clip.querySelector('path').getAttribute('d'));
  for (const r of clip.querySelectorAll('rect')) bubbleMask.rect(...['x', 'y', 'width', 'height'].map(k => Number(r.getAttribute(k))));
  updateMouseHandling();
}
document.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; updateMouseHandling(); });
function hideBubble() { clearTimeout(dismissTimer); visible = false; for (const id of deductions.keys()) clearDeduction(id); $('bubble').hidden = true; updateMouseHandling(); }
function armDismiss() { clearTimeout(dismissTimer); const seconds = state?.preferences.bubbleSeconds ?? 10; if (visible && !refreshing && seconds > 0) dismissTimer = setTimeout(hideBubble, seconds * 1000); }
function displayAmount(st, profile) {
  const result = refreshing || st.status === 'loading' ? st.snapshot || st.cached : st.status === 'ok' && !manualError ? st.snapshot : null;
  const text = V.amount(result, profile);
  return V.convertedResult(result, profile)?.currency === 'USD' ? text.replace(/^US(?=\$)/, '') : text;
}
function render(s) {
  const previousSeconds = state?.preferences.bubbleSeconds;
  const changes = observeBalances(s);
  state = s; document.body.classList.remove('size-150', 'size-190', 'size-230'); document.body.classList.add('size-' + s.preferences.petSize); $('bubble').hidden = !visible; $('content').replaceChildren();
  applySkin(s);
  applyLayout(s.petLayout);
  const selected = s.sites.find(p => p.id === s.selected) || s.sites[0];
  const sites = s.preferences.bubbleMode === 'selected' ? (selected ? [selected] : []) : s.sites;
  $('bubble').classList.toggle('multiple', sites.length > 1);
  $('bubble').setAttribute('aria-busy', refreshing ? 'true' : 'false');
  $('bubble').setAttribute('aria-label', s.demo ? '中转站名称和余额，当前为演示数据' : '中转站名称和余额');
  if (!sites.length) { $('content').append(V.el('div', 'single-name', '未设置中转站'), V.el('div', 'single-money', '—')); }
  else for (const p of sites) {
    const st = s.states[p.id] || { status: 'waiting' }, r = st.snapshot;
    const low = !refreshing && st.status === 'ok' && p.alert && r?.amount != null && r.amount <= p.threshold;
    const money = V.el('div', (sites.length === 1 ? 'single-money' : 'row-money') + (low ? ' low' : ''), displayAmount(st, p)); money.dataset.moneySite = p.id;
    if (sites.length === 1) $('content').append(V.el('div', 'single-name', p.name), money);
    else { const row = V.el('div', 'pet-row'); row.append(V.el('div', 'row-name', p.name), money); $('content').append(row); }
  }
  if (visible) for (const change of changes) if (sites.some(p => p.id === change.id)) animateDeduction(change.id, change.amount, change.currency);
  positionDeductions();
  if (previousSeconds !== undefined && previousSeconds !== s.preferences.bubbleSeconds) armDismiss();
  requestAnimationFrame(updateMouseHandling);
}
function clickFeedback() {
  if (state?.preferences.clickSound !== false) {
    const sound = $('tap-sound');
    try { sound.pause(); sound.currentTime = 0; sound.volume = (state?.preferences.clickVolume ?? 70) / 100; sound.play().catch(() => {}); } catch {}
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pressAnimation?.cancel();
    pressAnimation = $('character').animate([
      { transform: 'translateZ(0) scale(1, 1)', offset: 0 },
      { transform: 'translateZ(0) scale(1.04, 0.93)', offset: .3 },
      { transform: 'translateZ(0) scale(0.99, 1.018)', offset: .7 },
      { transform: 'translateZ(0) scale(1, 1)', offset: 1 },
    ], { duration: 300, easing: 'ease-out' });
    pressAnimation.finished.then(updateMouseHandling).catch(() => {});
  }
}
async function askBalance() {
  clickFeedback(); visible = true; clearTimeout(dismissTimer);
  if (refreshing || performance.now() - lastClick < 600) { if (state) render(state); armDismiss(); return; }
  lastClick = performance.now(); refreshing = true; manualError = '';
  try { if (!state) state = await window.whale.state(); render(state); const id = state.preferences.bubbleMode === 'selected' ? state.selected : 'all'; if (state.sites.length) render(await window.whale.refresh(id || 'all')); }
  catch (e) { manualError = e.message; }
  finally { refreshing = false; if (state) render(state); armDismiss(); }
}
document.addEventListener('contextmenu', e => { e.preventDefault(); window.whale.manage(); });
document.addEventListener('pointerdown', () => document.body.classList.remove('keyboard-focus'), true);
document.addEventListener('keydown', e => { if (e.key === 'Tab') document.body.classList.add('keyboard-focus'); if (e.key === 'Escape') hideBubble(); });
$('character').addEventListener('pointerdown', e => { if (e.button !== 0) return; pointer = { x: e.screenX, y: e.screenY, moving: false }; $('character').setPointerCapture(e.pointerId); window.whale.drag({ phase: 'start', x: e.screenX, y: e.screenY }); });
$('character').addEventListener('pointermove', e => { if (!pointer) return; if (Math.hypot(e.screenX - pointer.x, e.screenY - pointer.y) > 5) pointer.moving = true; if (pointer.moving) { $('character').classList.add('dragging'); window.whale.drag({ phase: 'move', x: e.screenX, y: e.screenY }); } });
$('character').addEventListener('pointerup', e => { if (!pointer) return; const moving = pointer.moving; pointer = null; $('character').classList.remove('dragging'); window.whale.drag({ phase: 'end', x: e.screenX, y: e.screenY }); if (!moving) askBalance(); updateMouseHandling(); });
$('character').addEventListener('pointercancel', e => { pointer = null; $('character').classList.remove('dragging'); window.whale.drag({ phase: 'end', x: e.screenX, y: e.screenY }); updateMouseHandling(); });
$('character').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); askBalance(); } });
$('character-art').addEventListener('load', loadCharacter); if ($('character-art').complete) loadCharacter();
$('bubble-art').addEventListener('load', loadBubble); if ($('bubble-art').complete) loadBubble();
window.whale.onState(render); window.whale.onLayout(layout => { applyLayout(layout); positionDeductions(); }); window.whale.state().then(render);
$('content').addEventListener('scroll', positionDeductions);

