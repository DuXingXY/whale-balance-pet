'use strict';
(() => {
  const V = window.View, $ = id => document.getElementById(id);
  const panel = V.el('section', 'usage-panel'); panel.id = 'usage-panel'; panel.setAttribute('aria-labelledby', 'usage-title');
  panel.innerHTML = `<h2 id="usage-title" class="usage-sr">用量汇总</h2>
    <div class="usage-toolbar"><div class="usage-tabs" role="group" aria-label="用量视图"><button type="button" data-usage-tab="overview" aria-pressed="true">概览</button><button type="button" data-usage-tab="models" aria-pressed="false">模型</button><button type="button" data-usage-tab="sites" aria-pressed="false">站点</button></div><div class="usage-ranges" role="group" aria-label="统计时间范围"><button type="button" data-usage-range="all" aria-pressed="false">累计</button><button type="button" data-usage-range="90" aria-pressed="false">90d</button><button type="button" data-usage-range="30" aria-pressed="true">30d</button><button type="button" data-usage-range="7" aria-pressed="false">7d</button><button id="usage-refresh" type="button" aria-label="刷新用量" title="刷新用量"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></svg></button></div></div>
    <div id="usage-overview-view"><div id="usage-metrics" class="usage-metrics"></div><div class="usage-heat-wrap"><div id="usage-heatmap" role="group" aria-label="每日总 Token 热力图，按列从周一到周日排列"></div><div id="usage-day-tooltip" role="tooltip" hidden></div></div>
    <div class="usage-heat-footer"><span id="usage-heat-caption">每日 Token · 颜色越浅，用量越高</span><span class="usage-heat-legend" aria-label="颜色从灰色无调用到深蓝、浅蓝表示用量增加">少 <i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i> 多</span></div></div>
    <div id="usage-sites-view" class="usage-table-wrap" hidden><table class="usage-table"><caption id="usage-sites-caption">各站点用量与合计</caption><thead><tr><th scope="col">站点 / Key</th><th scope="col">总 Token</th><th scope="col">请求次数</th><th scope="col" id="usage-days-head">活跃天数</th><th scope="col" id="usage-model-head">常用模型</th><th scope="col">数据状态</th></tr></thead><tbody id="usage-site-rows"></tbody><tfoot id="usage-site-total"></tfoot></table></div>
    <div id="usage-models-view" class="usage-table-wrap" hidden><table class="usage-table"><caption id="usage-models-caption">模型排行 · 按请求次数</caption><thead><tr><th scope="col">模型</th><th scope="col">请求次数</th><th scope="col">总 Token</th><th scope="col">输入 Token</th><th scope="col">输出 Token</th></tr></thead><tbody id="usage-model-rows"></tbody></table></div>
    <div class="usage-footbar"><p id="usage-notice" class="usage-notice" role="status">正在读取用量…</p><details class="usage-day-details"><summary>每日数据</summary><div class="usage-table-wrap"><table class="usage-table"><caption>所选范围的每日用量</caption><thead><tr><th scope="col">日期</th><th scope="col">总 Token</th><th scope="col">请求次数</th></tr></thead><tbody id="usage-daily-rows"></tbody></table></div></details><details class="usage-help"><summary>统计说明</summary><p id="usage-scope" class="usage-scope">活跃天数按日期去重；常用模型按请求次数排名；缺少统计的站点不计入对应合计。</p></details></div>`;
  document.querySelector('.overview').before(panel);
  let range = '30', tab = 'overview', loading = false, signature = '', dirty = false;
  const number = n => n == null ? '—' : n.toLocaleString('zh-CN');
  const short = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : number(n);
  function row(values, cls = '') { const tr = V.el('tr', cls); values.forEach((value, i) => { const cell = V.el(i === 0 ? 'th' : 'td', '', value); if (i === 0) cell.scope = 'row'; tr.append(cell); }); return tr; }
  function coverage(n, s) { return n < s.sources ? `部分合计 · ${n}/${s.sources} 个 Key 提供数据` : `${n} 个 Key 提供数据`; }
  function renderHeatmap(s) {
    const grid = $('usage-heatmap'), tooltip = $('usage-day-tooltip'); grid.replaceChildren(); tooltip.hidden = true;
    const end = new Date(s.period.end + 'T00:00:00Z'), sunday = new Date(end);
    sunday.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7);
    const start = new Date(sunday); start.setUTCDate(start.getUTCDate() - 181);
    const days = new Map(s.daily.map(d => [d.date, d]));
    const maximum = Math.max(1, ...s.daily.map(d => d.total_tokens || 0));
    const dailyRows = $('usage-daily-rows'); dailyRows.replaceChildren();
    function show(cell, text) {
      tooltip.textContent = text; tooltip.hidden = false;
      const bounds = grid.parentElement.getBoundingClientRect(), box = cell.getBoundingClientRect();
      tooltip.style.left = Math.max(105, Math.min(bounds.width - 105, box.left - bounds.left + box.width / 2)) + 'px';
      tooltip.style.top = box.top - bounds.top - 6 + 'px';
    }
    for (let i = 0; i < 182; i++) {
      const date = new Date(start); date.setUTCDate(start.getUTCDate() + i);
      const key = date.toISOString().slice(0, 10), inRange = key >= s.period.start && key <= s.period.end;
      const d = days.get(key), available = inRange && s.activeCoverage > 0, tokens = available ? (d ? d.total_tokens : 0) : null;
      const calls = available ? (d ? d.requests : 0) : null;
      const level = tokens == null ? 'unknown' : tokens === 0 ? '0' : String(Math.min(4, Math.max(1, Math.ceil(tokens / maximum * 4))));
      const description = key + ' · ' + (inRange ? `${tokens == null ? 'Token 未提供' : number(tokens) + ' Token'} · ${calls == null ? '请求次数未提供' : number(calls) + ' 次请求'}${s.activeCoverage < s.sources ? '（部分站点）' : ''}` : key > s.period.end ? '不在所选范围 / 尚未到来' : '不在所选范围');
      const cell = V.el('button', 'usage-heat-cell'); cell.type = 'button'; cell.tabIndex = key === s.period.end ? 0 : -1; cell.dataset.date = key; cell.dataset.level = level; cell.setAttribute('aria-label', description); cell.setAttribute('aria-describedby', 'usage-day-tooltip');
      cell.addEventListener('pointerenter', () => show(cell, description)); cell.addEventListener('focus', () => show(cell, description));
      cell.addEventListener('pointerleave', () => { if (document.activeElement !== cell) tooltip.hidden = true; }); cell.addEventListener('blur', () => { tooltip.hidden = true; });
      cell.addEventListener('click', () => show(cell, description)); cell.addEventListener('keydown', e => {
        if (e.key === 'Escape') { tooltip.hidden = true; e.stopPropagation(); }
        const offset = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
        if (offset) { e.preventDefault(); const next = grid.children[Math.max(0, Math.min(181, i + offset))]; cell.tabIndex = -1; next.tabIndex = 0; next.focus({ preventScroll: true }); }
      });
      grid.append(cell);
      if (inRange) dailyRows.prepend(row([key, number(tokens), number(calls)]));
    }
    $('usage-heat-caption').textContent = `每日 Token · 近 ${s.period.days} 天${s.activeCoverage < s.sources ? ' · 部分数据' : ''}`;
    for (const swatch of panel.querySelectorAll('.usage-heat-legend i')) { const level = Number(swatch.dataset.level); swatch.title = level === 0 ? '0 Token' : `${number(Math.floor((level - 1) * maximum / 4) + 1)} — ${number(Math.ceil(level * maximum / 4))} Token`; }
  }
  function render(s) {
    const all = s.period.range === 'all', recent = all ? '近 90 天' : `近 ${s.period.days} 天`;
    $('usage-metrics').replaceChildren();
    for (const [label, value, detail, exact] of [
      ['输入 Token', short(s.totals.input_tokens), coverage(s.metricCoverage.input_tokens, s), number(s.totals.input_tokens)],
      ['API 请求次数', number(s.totals.requests), coverage(s.metricCoverage.requests, s)],
      [all ? '累计总 Token' : '总 Token', short(s.totals.total_tokens), coverage(s.metricCoverage.total_tokens, s), number(s.totals.total_tokens)],
      [all ? '活跃天数 · 近 90 天' : '活跃天数', s.activeDays == null ? '—' : s.activeDays + ' 天', coverage(s.activeCoverage, s)],
      ['输出 Token', short(s.totals.output_tokens), coverage(s.metricCoverage.output_tokens, s), number(s.totals.output_tokens)],
      [all ? '常用模型 · 近 90 天' : '常用模型', s.favorite || '—', '按请求次数 · ' + coverage(s.modelCoverage, s)],
    ]) { const card = V.el('div', 'usage-metric'); const valueEl = V.el('strong', '', value); card.title = `${label}：${exact || value}\n${detail}`; card.append(V.el('span', '', label), valueEl); $('usage-metrics').append(card); }
    renderHeatmap(s);
    $('usage-days-head').textContent = '活跃天数' + (all ? '（90 天）' : ''); $('usage-model-head').textContent = '常用模型' + (all ? '（90 天）' : '');
    $('usage-sites-caption').textContent = `各站点用量与合计 · ${all ? '累计总量；活跃与模型为近 90 天' : recent}`;
    $('usage-site-rows').replaceChildren();
    const labels = { ok: '已读取', unsupported: '未提供', duplicate: '重复 Key 已去重', unconfigured: '待配置', error: '查询失败' };
    for (const r of s.rows) {
      const tr = row([r.name, number(r.metrics?.total_tokens), number(r.metrics?.requests), r.dates == null ? '—' : r.dates.length + ' 天', r.favorite || '—', labels[r.status]], r.status === 'error' ? 'usage-error' : '');
      const status = tr.lastChild; if (r.error) { const note = V.el('small', 'usage-row-note', r.error); status.append(note); }
      if (r.code) { const details = V.el('details', 'usage-diagnostics'), summary = V.el('summary', '', '错误详情（可复制）'); details.append(summary, V.el('pre', '', JSON.stringify({ code: r.code, ...r.details }, null, 2))); status.append(details); }
      $('usage-site-rows').append(tr);
    }
    if (!s.rows.length) { const tr = row(['尚未添加站点，请先添加站点和 API Key。']); tr.firstChild.colSpan = 6; $('usage-site-rows').append(tr); }
    $('usage-site-total').replaceChildren(row(['汇总（已提供的数据）', number(s.totals.total_tokens), number(s.totals.requests), s.activeDays == null ? '—' : s.activeDays + ' 天', s.favorite || '—', `${s.included}/${s.sources} 个 Key 有统计`]));
    $('usage-models-caption').textContent = `模型排行 · ${recent} · 按请求次数（相同模型名合并）`;
    $('usage-model-rows').replaceChildren();
    for (const m of s.models || []) $('usage-model-rows').append(row([m.model, number(m.requests), number(m.total_tokens), number(m.input_tokens), number(m.output_tokens)]));
    if (!s.models?.length) { const tr = row(['暂无模型记录，或接口未提供模型统计。']); tr.firstChild.colSpan = 5; $('usage-model-rows').append(tr); }
    $('usage-scope').textContent = `活跃天数按香港时间（UTC+8）取日期并跨站去重；常用模型按请求次数排名。统计仅覆盖已配置的 Key，相同站点与 Key 去重，未提供或失败的字段不计入合计。热力图斜纹格表示未提供数据或不在所选范围，纯灰格表示零用量；悬停或用方向键可查看数值，所有日期也可在“每日数据”表格查看。${all ? '累计模式：Token / 请求为接口累计值，活跃天数、模型和热力图仅覆盖近 90 天。' : ''}`;
    $('usage-notice').textContent = `已更新 · ${s.included}/${s.sources} 个 Key 有统计${all ? ' · 活跃 / 模型 / 热力图为近 90 天' : ''}`;
    $('usage-notice').title = `${s.period.start} — ${s.period.end} · 更新 ${new Date(s.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
  }
  async function load() {
    if (loading) { dirty = true; return; }
    dirty = false; loading = true; panel.setAttribute('aria-busy', 'true');
    $('usage-refresh').disabled = true; for (const b of panel.querySelectorAll('[data-usage-range]')) b.disabled = true;
    $('usage-notice').textContent = '正在查询各站用量，保留上次结果…';
    try { render(await window.whale.usage(range)); } catch (e) { $('usage-notice').textContent = '用量查询失败：' + e.message; }
    finally { loading = false; panel.setAttribute('aria-busy', 'false'); $('usage-refresh').disabled = false; for (const b of panel.querySelectorAll('[data-usage-range]')) b.disabled = false; if (dirty) load(); }
  }
  $('usage-refresh').onclick = load;
  for (const b of panel.querySelectorAll('[data-usage-range]')) b.onclick = () => {
    range = b.dataset.usageRange;
    for (const item of panel.querySelectorAll('[data-usage-range]')) item.setAttribute('aria-pressed', String(item === b));
    load();
  };
  for (const b of panel.querySelectorAll('[data-usage-tab]')) b.onclick = () => {
    tab = b.dataset.usageTab; for (const item of panel.querySelectorAll('[data-usage-tab]')) item.setAttribute('aria-pressed', String(item === b));
    $('usage-overview-view').hidden = tab !== 'overview';
    $('usage-sites-view').hidden = tab !== 'sites'; $('usage-models-view').hidden = tab !== 'models';
  };
  function changed(s) {
    const next = JSON.stringify(s.sites.map(p => [p.id, p.revision]));
    if (next !== signature) { signature = next; load(); }
  }
  window.whale.onState(changed); window.whale.state().then(changed);
})();
