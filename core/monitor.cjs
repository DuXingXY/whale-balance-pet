'use strict';
const { writeJson } = require('./store.cjs');
const fs = require('node:fs'); const path = require('node:path');
const dayOf = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
class Monitor {
  constructor(store, provider, { notify = () => {}, changed = () => {}, now = Date.now } = {}) {
    this.store = store; this.provider = provider; this.notify = notify; this.changed = changed; this.now = now;
    this.states = new Map(); this.jobs = new Map(); this.alerted = new Set(); this.active = 0; this.queue = [];
    this.file = path.join(store.dir, 'observations.json'); this.books = {};
    try { this.books = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') this.books = {}; }
  }
  state(id) {
    const p = this.store.get(id); const state = this.states.get(id);
    const book = this.books[id];
    return { ...(state || { status: p?.keyCipher || p?.custom?.auth === 'none' ? 'waiting' : 'unconfigured' }),
      decrease: book?.day === dayOf(this.now()) ? book.decrease : 0, ...(book ? { cached: book.snapshot, cachedAt: book.at } : {}) };
  }
  all() { return Object.fromEntries(this.store.data.sites.map(p => [p.id, this.state(p.id)])); }
  invalidate(id) {
    this.jobs.get(id)?.controller.abort(); this.states.delete(id); delete this.books[id]; this.alerted.delete(id);
    this.flush(); this.changed();
  }
  flush() { try { writeJson(this.file, this.books); } catch {} }
  refresh(id) {
    if (this.jobs.has(id)) return this.jobs.get(id).promise;
    const p = this.store.get(id); if (!p) return Promise.resolve();
    const controller = new AbortController(), job = { controller };
    job.promise = new Promise(resolve => { job.resolve = resolve; }); this.jobs.set(id, job);
    this.queue.push({ p: structuredClone(p), job }); this.drain(); return job.promise;
  }
  drain() {
    while (this.active < 3 && this.queue.length) {
      const { p, job } = this.queue.shift(); this.active++;
      this.run(p, job).finally(() => { this.active--; if (this.jobs.get(p.id) === job) this.jobs.delete(p.id); job.resolve(); this.drain(); });
    }
  }
  current(p, job) { return !job.controller.signal.aborted && this.store.get(p.id)?.revision === p.revision; }
  async run(p, job) {
    if (!this.current(p, job)) return;
    this.states.set(p.id, { ...this.state(p.id), status: 'loading' }); this.changed();
    try {
      const result = await this.provider.query(p, this.store.key(p), job.controller.signal);
      if (!this.current(p, job)) return;
      const now = this.now(), day = dayOf(now), prev = this.books[p.id];
      let decrease = prev?.day === day ? prev.decrease || 0 : 0;
      if (prev?.day === day && prev.snapshot.kind === result.kind && prev.snapshot.currency === result.currency && typeof result.amount === 'number' && typeof prev.snapshot.amount === 'number' && result.amount < prev.snapshot.amount) decrease += prev.snapshot.amount - result.amount;
      this.books[p.id] = { day, decrease: Math.round(decrease * 1e8) / 1e8, snapshot: result, at: now };
      this.states.set(p.id, { status: 'ok', snapshot: result, updatedAt: now, nextAt: now + p.interval * 1000 });
      this.flush(); this.changed();
      const low = p.alert && result.kind !== 'subscription' && typeof result.amount === 'number' && result.amount <= p.threshold;
      if (low && !this.alerted.has(p.id)) { this.alerted.add(p.id); this.notify(p, result); }
      if (!low) this.alerted.delete(p.id);
    } catch (e) {
      if (!this.current(p, job)) return;
      this.states.set(p.id, { status: 'error', error: e.code ? e.message : '读取凭据或余额失败，请重新填写该站点 Key', nextAt: this.now() + Math.max(p.interval, 60) * 1000 }); this.changed();
    }
  }
  tick() { for (const p of this.store.data.sites) if (p.enabled && (p.keyCipher || p.custom.auth === 'none') && !this.jobs.has(p.id) && (this.states.get(p.id)?.nextAt || 0) <= this.now()) this.refresh(p.id); }
  start() { this.tick(); this.timer = setInterval(() => this.tick(), 1000); }
  stop() { clearInterval(this.timer); for (const job of this.jobs.values()) job.controller.abort(); }
}
module.exports = { Monitor, dayOf };
