'use strict';
window.SpendingView = {
  create(panel) {
    const V = window.View, $ = id => document.getElementById(id);
    const view = V.el('div'); view.id = 'usage-spending-view'; view.hidden = true;
    view.innerHTML = `<div class="spend-heading"><div><h3>每日消耗金额</h3><p>按香港时间（UTC+8）分日 · 保留近 90 天的本机观测记录</p></div><div class="spend-filters"><label>站点<select id="spend-site"><option value="all">全部站点</option></select></label><label>日期范围<select id="spend-range"><option value="7">近 7 天</option><option value="30" selected>近 30 天</option><option value="90">近 90 天</option></select></label></div></div>
      <div id="spend-today" class="spend-today" aria-label="各站今日观测消耗"></div>
      <section id="spend-timer" class="spend-timer" aria-labelledby="spend-timer-title"><div class="spend-timer-head"><div><h3 id="spend-timer-title">消费秒表</h3><p>记录一段工作时间内的余额下降</p></div><label>计时站点<select id="spend-timer-site" aria-label="计时站点"></select></label></div><div class="spend-timer-readings"><div><span>已计时间</span><strong id="spend-time" aria-label="已计时间">00:00:00</strong></div><div><span>本次观测消耗</span><strong id="spend-amount">—</strong></div></div><div class="spend-timer-actions"><div class="spend-controls"><button id="spend-start" type="button" class="primary">开始计时</button><button id="spend-pause" type="button" class="secondary" hidden>暂停</button><button id="spend-resume" type="button" class="primary" hidden>继续计时</button><button id="spend-stop" type="button" class="secondary" hidden>结束计时</button><button id="spend-reset" type="button" class="secondary" hidden>重置</button><button id="spend-refresh" type="button" class="secondary">更新金额</button></div><span id="spend-status" role="status">未开始</span></div><p id="spend-last" class="spend-last">开始时先查询余额，以成功读数作为起点。</p><p id="spend-error" class="spend-error" role="alert" hidden></p></section>
      <details class="spend-history" open><summary>每日金额明细</summary><div class="usage-table-wrap"><table class="usage-table"><caption id="spend-history-caption">近 30 天的已观测日期；没有记录的日期不补零</caption><thead><tr><th scope="col">日期</th><th scope="col">站点</th><th scope="col">观测消耗</th><th scope="col">金额类型</th><th scope="col">成功采样</th></tr></thead><tbody id="spend-rows"></tbody></table></div></details>
      <details class="spend-help"><summary>金额统计说明</summary><p>启用本站金额转换后，按该站点比例显示美元或人民币。修改比例或显示币种会重新显示现有历史与秒表结果；接口原值保持不变。可在站点设置中修改，转换方向为“接口金额 × 比例 = 显示金额”。</p><p>金额累计同一币种、同一额度类型的余额下降，充值不会抵消。共享钱包的多个 Key 可能观测到同一笔扣款，因此各站分别显示；不做跨站或跨币种合计。订阅窗口与无限额度没有可统计的余额金额。</p><p>每日记录从首次成功采样开始；跨午夜的下降无法准确拆分，不计入每日金额。没有采样的日期显示为缺失。记录不是完整账单，也无法区分消费、调账与退款。</p><p>秒表开始、暂停、继续及运行中结束时会重新查询余额。暂停期间的下降不计入；查询失败保留运行状态，可重试。金额按站点刷新间隔更新，也可点“更新金额”；秒数每秒更新。计时中的站点即使关闭自动刷新也会采样。关闭管理窗口继续计时，退出程序后暂停，重开时可继续。</p></details>`;
    panel.querySelector('.usage-footbar').before(view);
    let state, pending = false, historySignature = '', sitesSignature = '', currentDay = '', lastError = '';
    const todayCards = new Map();
    const money = (amount, currency) => amount == null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(amount);
    const time = at => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false });
    const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    function choices() {
      const signature = JSON.stringify(state.sites.map(p => [p.id, p.name]));
      if (signature === sitesSignature) return;
      sitesSignature = signature;
      for (const id of ['spend-site', 'spend-timer-site']) {
        const select = $(id), previous = select.value;
        select.replaceChildren();
        if (id === 'spend-site') { const option = V.el('option', '', '全部站点'); option.value = 'all'; select.append(option); }
        for (const p of state.sites) { const option = V.el('option', '', p.name); option.value = p.id; select.append(option); }
        if ([...select.options].some(o => o.value === previous)) select.value = previous;
      }
    }
    function tick() {
      if (!state?.spending) return;
      const s = state.spending.session;
      const seconds = Math.floor(((s.elapsedMs || 0) + (s.status === 'running' ? Math.max(0, Date.now() - s.runningSince) : 0)) / 1000);
      const days = Math.floor(seconds / 86400), hh = String(Math.floor(seconds / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(seconds / 60) % 60).padStart(2, '0'), ss = String(seconds % 60).padStart(2, '0');
      $('spend-time').textContent = (days ? days + '天 ' : '') + `${hh}:${mm}:${ss}`;
      if (currentDay !== day()) { currentDay = day(); renderDaily(); }
    }
    function renderDaily() {
      if (!state?.spending) return;
      const filter = $('spend-site').value, date = day(), history = state.spending.history;
      const sites = state.sites.filter(p => filter === 'all' || p.id === filter), ids = new Set(sites.map(p => p.id));
      for (const [id, card] of todayCards) if (!ids.has(id)) { card.remove(); todayCards.delete(id); }
      for (const p of sites) {
        let card = todayCards.get(p.id);
        if (!card) { card = V.el('div', 'spend-day-card'); card.append(V.el('span'), V.el('strong'), V.el('small')); todayCards.set(p.id, card); $('spend-today').append(card); }
        const rows = history.filter(r => r.date === date && r.siteId === p.id), snapshot = V.result(state.states[p.id] || {});
        card.children[0].textContent = p.name + ' · 今日';
        const shown = rows.map(r => ({ ...r, ...V.convert(r.amount, r.currency, p) }));
        card.children[1].textContent = rows.length ? shown.map(r => money(r.amount, r.currency)).join(' / ') : '—';
        card.children[2].textContent = rows.length ? shown.map(r => `${V.kind[r.kind]} · ${r.currency}${r.converted ? ' · 已换算' : ''}`).join(' / ') : snapshot?.kind === 'subscription' || snapshot?.unlimited ? '此额度类型未提供可统计金额' : '今天尚无成功采样';
        card.title = rows.length ? rows.map(r => `${r.samples} 次采样 · ${time(r.firstAt)} 至 ${time(r.lastAt)}\n${V.conversionNote(r.currency, p)}；原值 ${money(r.amount, r.currency)}`).join('\n') : '没有记录时不按零处理';
      }
      if (!sites.length) $('spend-today').textContent = '请先添加站点，成功查询后开始记录。';
      else { for (const child of [...$('spend-today').childNodes]) if (child.nodeType === Node.TEXT_NODE) child.remove(); }
      const days = Number($('spend-range').value), cutoff = new Date(Date.now() + 8 * 3600000 - (days - 1) * 86400000).toISOString().slice(0, 10);
      const rows = history.filter(r => r.date >= cutoff && r.date <= date && (filter === 'all' || r.siteId === filter)).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
      const signature = JSON.stringify([days, filter, date, rows, sites.map(p => [p.id, p.moneyConversion])]);
      if (signature === historySignature) return;
      historySignature = signature; $('spend-rows').replaceChildren();
      for (const r of rows) {
        const profile = state.sites.find(p => p.id === r.siteId), shown = V.convert(r.amount, r.currency, profile);
        const tr = V.el('tr');
        for (const [i, text] of [r.date, r.name, money(shown.amount, shown.currency) + ' ' + shown.currency, V.kind[r.kind], r.migrated ? `${r.samples} 次 · 含旧版记录` : `${r.samples} 次`].entries()) { const td = V.el(i === 0 ? 'th' : 'td', '', text); if (i === 0) td.scope = 'row'; tr.append(td); }
        tr.title = `采样范围：${time(r.firstAt)} 至 ${time(r.lastAt)}；不代表全天账单\n${V.conversionNote(r.currency, profile)}；原值 ${money(r.amount, r.currency)}`; $('spend-rows').append(tr);
      }
      if (!rows.length) { const tr = V.el('tr'), td = V.el('td', '', '此范围暂无金额记录。成功采样后会在这里显示。'); td.colSpan = 5; tr.append(td); $('spend-rows').append(tr); }
      $('spend-history-caption').textContent = `近 ${days} 天的已观测日期 · 空缺日期不补零 · 首次单次采样的 0 不代表当天无消费`;
    }
    function render(s) {
      state = s; if (!s.spending) return;
      choices(); renderDaily();
      const session = s.spending.session, running = session.status === 'running', paused = session.status === 'paused', idle = session.status === 'idle';
      const busy = pending || s.spending.busy;
      if (session.siteId && [...$('spend-timer-site').options].some(o => o.value === session.siteId)) $('spend-timer-site').value = session.siteId;
      $('spend-timer-site').disabled = !idle || busy || !s.sites.length;
      for (const [action, show] of [['start', idle], ['pause', running], ['resume', paused], ['stop', running || paused], ['reset', !idle && !running], ['refresh', true]]) {
        const button = $('spend-' + action); button.hidden = !show; button.disabled = busy || !s.sites.length && action !== 'reset';
        if (action === 'refresh' && session.siteId && !s.sites.some(p => p.id === session.siteId)) button.disabled = true;
      }
      $('spend-timer').setAttribute('aria-busy', String(busy));
      const shown = V.convert(session.amount, session.currency, session);
      $('spend-amount').textContent = money(shown.amount, shown.currency);
      $('spend-amount').title = V.conversionNote(session.currency, session) + (shown.converted ? '；原值 ' + money(session.amount, session.currency) : '');
      $('spend-status').textContent = busy ? '正在采样余额…' : ({ idle: '未开始', running: '计时中', paused: '已暂停', stopped: '已结束' }[session.status]);
      const siteState = s.states[session.siteId];
      $('spend-last').textContent = idle ? '开始时先查询余额，以成功读数作为起点。' : `${session.name} · ${shown.currency} · ${V.kind[session.kind]}${shown.converted ? ' · ' + V.conversionNote(session.currency, session) : ''}${session.lastAt ? ' · 金额采样 ' + time(session.lastAt) : ''}${session.note ? ' · ' + session.note : ''}${running && siteState?.status === 'error' ? ' · 余额查询失败，显示上次采样金额' : ''}`;
      $('spend-error').hidden = !lastError; $('spend-error').textContent = lastError; tick();
    }
    for (const action of ['start', 'pause', 'resume', 'stop', 'reset', 'refresh']) $('spend-' + action).onclick = async () => {
      if (pending || state?.spending?.busy) return;
      pending = true; lastError = ''; render(state);
      try {
        if (action === 'refresh') await window.whale.refresh(state.spending.session.siteId || $('spend-timer-site').value);
        else await window.whale.spendingControl({ action, siteId: $('spend-timer-site').value });
        state = await window.whale.state();
        if (action === 'refresh' && state.states[state.spending.session.siteId || $('spend-timer-site').value]?.status === 'error') lastError = '余额查询失败，金额保留上次成功采样值。';
      } catch (e) { lastError = e.message; }
      finally { pending = false; render(state); }
    };
    $('spend-site').onchange = renderDaily; $('spend-range').onchange = renderDaily;
    window.whale.onState(render); window.whale.state().then(render);
    setInterval(tick, 1000);
    return view;
  },
};
