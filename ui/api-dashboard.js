'use strict';
(() => {
  const V = window.View, D = window.UsageData;
  const number = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const short = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : number(n);
  const percent = n => n == null ? '—' : n.toFixed(1) + '%';
  const statuses = { ok: '已读取', unsupported: '未提供统计', duplicate: '共享同一 Key 的统计', unconfigured: '待配置 Key', error: '查询失败' };
  function svgNode(name, attributes = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    return el;
  }
  function create(panel) {
    const view = V.el('div', 'api-dashboard'); view.id = 'usage-api-view'; view.hidden = true;
    view.innerHTML = `<div class="api-dashboard-heading"><div><h3>API 仪表盘</h3><p>查看每个站点 / API Key 的用量</p></div><label for="usage-api-site">站点 / Key<select id="usage-api-site"></select></label></div>
      <p id="usage-api-status" class="api-status" role="status">正在读取…</p>
      <div id="usage-api-metrics" class="api-metrics"></div>
      <div class="api-cache"><div><span>Token 缓存命中率</span><strong id="usage-api-cache-value">—</strong></div><progress id="usage-api-cache-bar" max="100" value="0" aria-label="Token 缓存命中率" hidden></progress><p>缓存读取 ÷（普通输入 + 缓存写入 + 缓存读取）。这是 Token 占比；无输入或缺少字段时不计算。</p></div>
      <section class="api-trend" aria-labelledby="usage-api-trend-title"><div class="api-trend-heading"><h4 id="usage-api-trend-title">每日输入与输出</h4><span class="api-trend-legend"><span class="api-input-label">输入（含缓存） · 实线</span><span class="api-output-label">输出 · 虚线</span></span></div><p id="usage-api-trend-note"></p><div id="usage-api-chart"></div></section>
      <details class="api-daily"><summary>查看每日明细</summary><div class="usage-table-wrap" tabindex="0" aria-label="每日 API 用量明细，可横向滚动"><table class="usage-table"><caption id="usage-api-daily-caption">每日数据</caption><thead><tr><th scope="col">日期</th><th scope="col">普通输入</th><th scope="col">输出</th><th scope="col">缓存写入</th><th scope="col">缓存读取</th><th scope="col">缓存命中率</th><th scope="col">请求次数</th><th scope="col">总 Token</th></tr></thead><tbody id="usage-api-daily-rows"></tbody></table></div></details>`;
    panel.querySelector('.usage-footbar').before(view);
    const $ = id => view.querySelector('#' + id), select = $('usage-api-site');
    let latest = null, selectedId = '', optionsSignature = '';
    function chart(daily, period) {
      const root = $('usage-api-chart'); root.replaceChildren();
      const values = daily.flatMap(d => [D.totalInput(d), d.output_tokens]).filter(n => n != null);
      if (!values.length) { root.append(V.el('p', 'api-chart-empty', '接口未提供所选范围的每日输入 / 输出数据。')); return; }
      const svg = svgNode('svg', { viewBox: '0 0 640 180', role: 'img', 'aria-labelledby': 'usage-api-chart-title usage-api-chart-desc' });
      svg.append(svgNode('title', { id: 'usage-api-chart-title' }, '每日输入和输出 Token 趋势'), svgNode('desc', { id: 'usage-api-chart-desc' }, '实线为含缓存的输入，虚线为输出。缺失日期和字段留空，不补零。精确数值可在下方每日明细表查看。'));
      const start = Date.parse(period.start), end = Date.parse(period.end), span = Math.max(86400000, end - start);
      const max = Math.max(1, ...values), x = date => 57 + (Date.parse(date) - start) / span * 565, y = n => 143 - n / max * 121;
      for (const value of [0, max / 2, max]) {
        svg.append(svgNode('line', { x1: 57, x2: 622, y1: y(value), y2: y(value), class: 'api-chart-grid' }), svgNode('text', { x: 49, y: y(value) + 4, 'text-anchor': 'end', class: 'api-chart-tick' }, short(value)));
      }
      const dates = [period.start, new Date(start + Math.floor((end - start) / 86400000 / 2) * 86400000).toISOString().slice(0, 10), period.end];
      for (const [i, date] of dates.entries()) svg.append(svgNode('text', { x: x(date), y: 170, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle', class: 'api-chart-tick' }, date.slice(5)));
      for (const [get, cls] of [[D.totalInput, 'api-chart-input'], [d => d.output_tokens, 'api-chart-output']]) {
        let path = '', previousDate = null;
        for (const d of daily) {
          const value = get(d);
          if (value == null) { previousDate = null; continue; }
          const consecutive = previousDate && Date.parse(d.date) - Date.parse(previousDate) === 86400000;
          path += `${consecutive ? 'L' : 'M'}${x(d.date).toFixed(2)},${y(value).toFixed(2)} `;
          svg.append(svgNode('circle', { cx: x(d.date), cy: y(value), r: 2, class: cls })); previousDate = d.date;
        }
        svg.append(svgNode('path', { d: path, class: cls, fill: 'none' }));
      }
      root.append(svg);
    }
    function draw() {
      if (!latest) return;
      const { selected, source } = D.dashboardSource(latest, selectedId), metrics = source?.status === 'ok' ? source.metrics : null;
      const all = latest.period.range === 'all', span = all ? '累计' : `近 ${latest.period.days} 天`;
      const daily = source?.status === 'ok' ? (source.daily || []).slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
      const rate = D.cacheHitRate(metrics), average = D.averageTokens(metrics);
      view.dataset.siteId = selected?.id || ''; view.dataset.sourceId = source?.id || '';
      const updated = new Date(latest.checkedAt).toLocaleTimeString('zh-CN', { hour12: false });
      $('usage-api-status').textContent = selected ? `${selected.name} · ${statuses[selected.status]} · ${span} · 更新 ${updated}${selected.error ? ' · ' + selected.error : ''}${source?.status === 'error' && selected !== source ? ' · ' + source.error : ''}` : '尚未添加站点，请先添加站点和 API Key。';
      $('usage-api-status').dataset.status = source?.status || 'empty';
      $('usage-api-metrics').replaceChildren();
      for (const [key, label, value, exact] of [
        ['input', '普通输入 Token', short(metrics?.input_tokens), metrics?.input_tokens],
        ['output', '输出 Token', short(metrics?.output_tokens), metrics?.output_tokens],
        ['write', '缓存写入 Token', short(metrics?.cache_creation_tokens), metrics?.cache_creation_tokens],
        ['read', '缓存读取 Token', short(metrics?.cache_read_tokens), metrics?.cache_read_tokens],
        ['total', '总 Token', short(metrics?.total_tokens), metrics?.total_tokens],
        ['requests', '请求次数', number(metrics?.requests), metrics?.requests],
        ['hit-rate', 'Token 缓存命中率', percent(rate), rate],
        ['average', '平均 Token / 请求', number(average), average],
      ]) { const card = V.el('div', 'api-metric'); card.dataset.metric = key; card.append(V.el('span', '', label), V.el('strong', '', value), V.el('small', '', exact == null ? '未提供 / 无法计算' : span)); card.title = label + '：' + (key === 'hit-rate' ? percent(exact) : number(exact)); $('usage-api-metrics').append(card); }
      $('usage-api-cache-value').textContent = percent(rate); $('usage-api-cache-bar').hidden = rate == null; $('usage-api-cache-bar').value = rate ?? 0;
      $('usage-api-trend-note').textContent = `${all ? '累计指标见上方；趋势和每日明细为近 90 天。' : latest.period.start + ' — ' + latest.period.end + '。'}仅展示接口返回的日期，缺失数据留空。`;
      chart(daily, latest.period);
      $('usage-api-daily-caption').textContent = `${selected?.name || '站点'} · ${latest.period.start} — ${latest.period.end} · Token / 次数`;
      $('usage-api-daily-rows').replaceChildren();
      for (const day of daily.slice().reverse()) {
        const tr = V.el('tr');
        const values = [day.date, number(day.input_tokens), number(day.output_tokens), number(day.cache_creation_tokens), number(day.cache_read_tokens), percent(D.cacheHitRate(day)), number(day.requests), number(day.total_tokens)];
        values.forEach((value, i) => { const cell = V.el(i === 0 ? 'th' : 'td', '', value); if (i === 0) cell.scope = 'row'; tr.append(cell); }); $('usage-api-daily-rows').append(tr);
      }
      if (!daily.length) { const tr = V.el('tr'), cell = V.el('td', '', '暂无每日记录，或接口未提供此范围的数据。'); cell.colSpan = 8; tr.append(cell); $('usage-api-daily-rows').append(tr); }
    }
    select.onchange = () => { selectedId = select.value; draw(); };
    function render(summary) {
      latest = summary;
      if (!summary.rows.some(r => r.id === selectedId)) selectedId = (summary.rows.find(r => r.status === 'ok') || summary.rows[0])?.id || '';
      const next = JSON.stringify(summary.rows.map(r => [r.id, r.name, r.status]));
      if (next !== optionsSignature) { optionsSignature = next; select.replaceChildren(); for (const r of summary.rows) { const option = V.el('option', '', `${r.name} · ${statuses[r.status]}`); option.value = r.id; select.append(option); } }
      select.disabled = !summary.rows.length; select.value = selectedId; draw();
    }
    return { render };
  }
  window.APIDashboard = { create };
})();
