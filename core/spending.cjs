'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { writeJson } = require('./store.cjs');
const { dayOf } = require('./monitor.cjs');
const round = n => Math.round(n * 1e8) / 1e8;
const measurable = r => r && !r.unlimited && r.kind !== 'subscription' && Number.isFinite(r.amount);
const compatible = (a, b) => measurable(a) && measurable(b) && a.currency === b.currency && a.kind === b.kind;
const fingerprint = p => createHash('sha256').update(JSON.stringify([p.baseUrl, p.provider, p.keyCipher, p.currency, p.custom, p.billingDivisor, p.quotaPerUnit])).digest('hex');
const fault = message => Object.assign(new Error(message), { code: 'SPENDING' });
class Spending {
  constructor(store, monitor, { now = Date.now, changed = () => {} } = {}) {
    this.store = store; this.monitor = monitor; this.now = now; this.changed = changed; this.busy = false;
    this.file = path.join(store.dir, 'spending.json'); this.data = { version: 1, sites: {}, session: { status: 'idle' } };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d.version !== 1 || !d.sites || !d.session) throw fault('消费记录文件版本无效');
      this.data = d;
    } catch (e) {
      if (e.code !== 'ENOENT') throw fault('消费记录文件无法读取，请保留 spending.json 并检查');
      // Preserve the one day of observations available in earlier versions.
      for (const p of store.data.sites) {
        const old = monitor.books[p.id];
        if (old && measurable(old.snapshot) && Number.isFinite(old.decrease)) this.data.sites[p.id] = {
          fingerprint: fingerprint(p), baseline: { snapshot: old.snapshot, at: old.at },
          history: [{ date: old.day, amount: old.decrease, currency: old.snapshot.currency, kind: old.snapshot.kind, samples: 1, firstAt: old.at, lastAt: old.at, migrated: true }],
        };
      }
    }
    // A crash must not silently extend a timed measurement through downtime.
    if (this.data.session.status === 'running') this.pause('上次程序退出，计时已暂停', this.data.session.lastAt);
    for (const id of Object.keys(this.data.sites)) if (!store.get(id)) delete this.data.sites[id];
    if (this.data.session.siteId && !store.get(this.data.session.siteId)) this.data.session = { status: 'idle' };
    this.persist();
  }
  persist() { writeJson(this.file, this.data); }
  configure(id, removed = false) {
    const p = this.store.get(id), previous = this.data.sites[id];
    if (removed || (previous && previous.fingerprint !== fingerprint(p))) delete this.data.sites[id];
    const s = this.data.session;
    if (s.siteId === id && (removed || s.fingerprint !== fingerprint(p))) {
      if (s.status === 'running') this.pause('站点配置已改变，本次计时已结束');
      s.status = 'stopped'; s.note = removed ? '站点已删除' : '站点或 Key 已改变，请重置后重新计时'; s.endedAt = this.now();
    }
    if (!removed && s.siteId === id && s.fingerprint === fingerprint(p)) s.name = p.name;
    if (!removed && s.siteId === id) s.moneyConversion = p.moneyConversion;
    this.persist();
  }
  observe(p, result, at) {
    let book = this.data.sites[p.id];
    if (!book || book.fingerprint !== fingerprint(p)) book = this.data.sites[p.id] = { fingerprint: fingerprint(p), history: [] };
    const date = dayOf(at), prev = book.baseline;
    if (measurable(result)) {
      let row = book.history.find(r => r.date === date && r.currency === result.currency && r.kind === result.kind);
      if (!row) { row = { date, currency: result.currency, kind: result.kind, amount: 0, samples: 0, firstAt: at, lastAt: at }; book.history.push(row); }
      // A midnight-spanning drop cannot be assigned accurately to either day.
      if (prev && dayOf(prev.at) === date && compatible(prev.snapshot, result)) row.amount = round(row.amount + Math.max(0, prev.snapshot.amount - result.amount));
      row.samples++; row.lastAt = at;
    }
    book.baseline = { snapshot: result, at };
    const cutoff = dayOf(at - 89 * 86400000);
    book.history = book.history.filter(r => r.date >= cutoff);
    const s = this.data.session;
    if (s.status === 'running' && s.siteId === p.id) {
      if (s.fingerprint !== fingerprint(p) || !compatible(s.baseline, result)) this.pause('金额币种或额度类型改变，计时已暂停', at);
      else { s.amount = round(s.amount + Math.max(0, s.baseline.amount - result.amount)); s.baseline = result; s.lastAt = at; }
    }
    this.persist();
  }
  pause(note = '', at = this.now()) {
    const s = this.data.session;
    if (s.status !== 'running') return;
    s.elapsedMs += Math.max(0, at - s.runningSince); s.runningSince = null; s.status = 'paused'; s.note = note;
  }
  summary() {
    const now = this.now(), cutoff = dayOf(now - 89 * 86400000);
    const history = this.store.data.sites.flatMap(p => (this.data.sites[p.id]?.history || []).filter(r => r.date >= cutoff).map(r => ({ ...r, siteId: p.id, name: p.name })));
    const { baseline, fingerprint: hash, ...session } = this.data.session;
    const profile = this.store.get(session.siteId);
    if (profile) session.moneyConversion = profile.moneyConversion;
    return { day: dayOf(now), history, session, busy: this.busy };
  }
  get runningSite() { return this.data.session.status === 'running' ? this.data.session.siteId : null; }
  async fresh(id) {
    const p = this.store.get(id); if (!p) throw fault('请先选择一个已保存的站点');
    const hash = fingerprint(p);
    // Join an existing request, then issue a new boundary sample.
    if (this.monitor.jobs.has(id)) await this.monitor.refresh(id);
    await this.monitor.refresh(id);
    if (!this.store.get(id) || fingerprint(this.store.get(id)) !== hash) throw fault('查询期间站点配置已改变，请重试');
    const st = this.monitor.state(id);
    if (st.status !== 'ok') throw fault('余额查询失败，本次操作未完成，请刷新后重试');
    if (!measurable(st.snapshot)) throw fault('此站点没有可统计的余额金额（订阅窗口或无限额度）');
    return { p: this.store.get(id), result: st.snapshot, at: st.updatedAt };
  }
  async control(arg) {
    if (this.busy) throw fault('正在采样余额，请稍候');
    const action = arg?.action;
    if (!['start', 'pause', 'resume', 'stop', 'reset'].includes(action)) throw fault('计时操作无效');
    this.busy = true; this.changed();
    try {
      let s = this.data.session;
      if (action === 'reset') {
        if (s.status === 'running') throw fault('请先暂停或结束计时，再重置');
        this.data.session = { status: 'idle' };
      } else if (action === 'start' || action === 'resume') {
        if (action === 'start' && s.status !== 'idle') throw fault('请先重置，再开始新的计时');
        if (action === 'resume' && s.status !== 'paused') throw fault('当前计时不能继续');
        const { p, result, at } = await this.fresh(action === 'start' ? arg.siteId : s.siteId);
        if (action === 'resume' && (s.fingerprint !== fingerprint(p) || !compatible(s.baseline, result))) throw fault('币种、额度类型或站点已改变，请重置后重新计时');
        if (action === 'start') s = this.data.session = { siteId: p.id, name: p.name, fingerprint: fingerprint(p), currency: result.currency, kind: result.kind, amount: 0, elapsedMs: 0, startedAt: at, moneyConversion: p.moneyConversion };
        Object.assign(s, { status: 'running', runningSince: at, lastAt: at, baseline: result, note: '' });
      } else {
        if (s.status !== 'running' && !(action === 'stop' && s.status === 'paused')) throw fault('当前没有可暂停或结束的计时');
        if (s.status === 'running') {
          await this.fresh(s.siteId);
          this.pause('', this.now());
        }
        if (action === 'stop') { s.status = 'stopped'; s.endedAt = this.now(); }
      }
      this.persist(); return this.summary();
    } finally { this.busy = false; this.changed(); }
  }
  shutdown() { this.pause('程序退出，计时已暂停'); this.persist(); }
}
module.exports = { Spending, measurable, compatible };
