'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../core/store.cjs'), { Monitor } = require('../core/monitor.cjs'), { Spending } = require('../core/spending.cjs');
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-spending-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString() });
  const p = store.save({ name: 'A', provider: 'sub2api', baseUrl: 'https://a.example', key: 'TEST-SECRET', enabled: false, ...options });
  let now = Date.UTC(2026, 9, 9, 10), amount = 100, currency = 'USD', kind = 'wallet', failure = false, calls = 0, spending;
  const provider = { query: async () => { calls++; if (failure) throw Object.assign(new Error('离线'), { code: 'NETWORK' }); return { amount, currency, kind, used: null, windows: [], unlimited: false }; } };
  const monitor = new Monitor(store, provider, { now: () => now, observed: (profile, result, at) => spending.observe(profile, result, at), watch: () => spending.runningSite });
  spending = new Spending(store, monitor, { now: () => now });
  return { store, p, monitor, get spending() { return spending; }, setAmount: n => amount = n, advance: n => now += n, setTime: n => now = n, fail: n => failure = n, currency: n => currency = n, kind: n => kind = n, calls: () => calls, restart: () => spending = new Spending(store, monitor, { now: () => now }) };
}
test('daily history persists across dates and recharge; unobserved days stay missing', async t => {
  const f = fixture(t); await f.monitor.refresh(f.p.id);
  f.setAmount(90); f.advance(60000); await f.monitor.refresh(f.p.id);
  f.setAmount(200); await f.monitor.refresh(f.p.id); f.setAmount(197.12345678); await f.monitor.refresh(f.p.id);
  assert.equal(f.spending.summary().history[0].amount, 12.87654322);
  f.fail(true); await f.monitor.refresh(f.p.id); assert.equal(f.spending.summary().history[0].samples, 4);
  f.fail(false); f.advance(86400000 * 2); f.setAmount(190); await f.monitor.refresh(f.p.id);
  f.setAmount(188); await f.monitor.refresh(f.p.id);
  assert.deepEqual(f.spending.summary().history.map(r => [r.date, r.amount]), [['2026-10-09', 12.87654322], ['2026-10-11', 2]]);
  f.restart(); assert.equal(f.spending.summary().history.length, 2);
  assert(!fs.readFileSync(f.spending.file, 'utf8').includes('TEST-SECRET'));
});
test('midnight in UTC+8 resets the daily baseline while stopwatch spans midnight', async t => {
  const f = fixture(t); f.setTime(Date.UTC(2026, 9, 9, 15, 59));
  await f.spending.control({ action: 'start', siteId: f.p.id });
  f.advance(120000); f.setAmount(95); await f.monitor.refresh(f.p.id);
  assert.equal(f.spending.summary().day, '2026-10-10');
  assert.deepEqual(f.spending.summary().history.map(r => r.amount), [0, 0]);
  assert.equal(f.spending.summary().session.amount, 5);
  f.setAmount(94); await f.monitor.refresh(f.p.id); assert.equal(f.spending.summary().history[1].amount, 1);
});
test('stopwatch samples boundaries, excludes paused spend, retains results on stop and reset', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id });
  f.advance(10000); f.setAmount(97.5); await f.spending.control({ action: 'pause' });
  assert.equal(f.spending.summary().session.amount, 2.5); assert.equal(f.spending.summary().session.elapsedMs, 10000);
  f.advance(20000); f.setAmount(50); await f.monitor.refresh(f.p.id);
  await f.spending.control({ action: 'resume' }); f.advance(5000); f.setAmount(49); await f.spending.control({ action: 'stop' });
  const s = f.spending.summary().session;
  assert.equal(s.amount, 3.5); assert.equal(s.elapsedMs, 15000); assert.equal(s.status, 'stopped');
  f.advance(60000); f.setAmount(40); await f.monitor.refresh(f.p.id); assert.equal(f.spending.summary().session.amount, 3.5);
  const count = f.spending.summary().history.length;
  await f.spending.control({ action: 'reset' }); assert.equal(f.spending.summary().session.status, 'idle'); assert.equal(f.spending.summary().history.length, count);
});
test('failed start/pause/stop never claims a successful boundary sample', async t => {
  const f = fixture(t); f.fail(true);
  await assert.rejects(f.spending.control({ action: 'start', siteId: f.p.id }), /查询失败/); assert.equal(f.spending.summary().session.status, 'idle');
  f.fail(false); await f.spending.control({ action: 'start', siteId: f.p.id }); f.fail(true); f.advance(10000);
  await assert.rejects(f.spending.control({ action: 'pause' }), /查询失败/);
  await assert.rejects(f.spending.control({ action: 'stop' }), /查询失败/);
  assert.equal(f.spending.summary().session.status, 'running'); assert.equal(f.spending.summary().session.amount, 0); assert.equal(f.spending.busy, false);
  f.fail(false); f.setAmount(98); await f.spending.control({ action: 'stop' }); assert.equal(f.spending.summary().session.amount, 2);
});
test('shutdown pauses persistently and resume excludes downtime; crashes pause at last sample', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id }); f.advance(10000); f.setAmount(99); await f.monitor.refresh(f.p.id);
  f.advance(5000); f.spending.shutdown(); f.advance(60000); f.setAmount(50); f.restart();
  assert.equal(f.spending.summary().session.status, 'paused'); assert.equal(f.spending.summary().session.elapsedMs, 15000);
  await f.spending.control({ action: 'resume' }); f.advance(2000); f.setAmount(49); await f.monitor.refresh(f.p.id);
  f.advance(50000); f.restart(); assert.equal(f.spending.summary().session.elapsedMs, 17000); assert.equal(f.spending.summary().session.amount, 2);
});
test('active stopwatch polls sites with automatic refresh disabled, stops polling when paused', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id }); const before = f.calls();
  f.advance(61000); f.monitor.tick(); await Promise.all([...f.monitor.jobs.values()].map(j => j.promise)); assert.equal(f.calls(), before + 1);
  await f.spending.control({ action: 'pause' }); const paused = f.calls(); f.advance(61000); f.monitor.tick(); assert.equal(f.calls(), paused);
});
test('currency/type changes pause stopwatch and remain separate in daily history', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id }); f.setAmount(95); await f.monitor.refresh(f.p.id);
  f.currency('CNY'); f.setAmount(1); await f.monitor.refresh(f.p.id);
  assert.equal(f.spending.summary().session.status, 'paused'); assert.equal(f.spending.summary().session.amount, 5);
  assert.deepEqual(f.spending.summary().history.map(r => [r.currency, r.amount]), [['USD', 5], ['CNY', 0]]);
  await assert.rejects(f.spending.control({ action: 'resume' }), /改变/);
  await f.spending.control({ action: 'reset' }); f.kind('subscription');
  await assert.rejects(f.spending.control({ action: 'start', siteId: f.p.id }), /没有可统计/);
});
test('name/interval changes retain history; credential changes and deletion reset source records', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id }); f.setAmount(90); await f.monitor.refresh(f.p.id);
  f.store.save({ ...f.p, name: 'Renamed', key: '', interval: 120 }); f.spending.configure(f.p.id);
  assert.equal(f.spending.summary().history[0].amount, 10); assert.equal(f.spending.summary().session.status, 'running');
  f.store.save({ ...f.store.public().sites[0], key: 'REPLACED' }); f.spending.configure(f.p.id);
  assert.equal(f.spending.summary().history.length, 0); assert.equal(f.spending.summary().session.status, 'stopped');
  f.spending.configure(f.p.id, true); f.store.remove(f.p.id); assert.equal(f.spending.summary().history.length, 0);
});
test('legacy observed day is imported once; history is bounded to 90 dates', async t => {
  const f = fixture(t); fs.unlinkSync(f.spending.file);
  f.monitor.books[f.p.id] = { day: '2026-10-09', decrease: 3, at: Date.UTC(2026, 9, 9, 10), snapshot: { amount: 97, currency: 'USD', kind: 'wallet' } };
  f.setAmount(96); f.restart(); await f.monitor.refresh(f.p.id);
  assert.equal(f.spending.summary().history[0].amount, 4); f.restart(); assert.equal(f.spending.summary().history[0].amount, 4);
  f.advance(90 * 86400000); await f.monitor.refresh(f.p.id); assert.equal(f.spending.summary().history.length, 1);
});
test('concurrent commands are rejected; changing source during boundary query cancels start', async t => {
  const f = fixture(t); let resolve; f.monitor.provider.query = () => new Promise(r => resolve = r);
  const start = f.spending.control({ action: 'start', siteId: f.p.id });
  await assert.rejects(f.spending.control({ action: 'start', siteId: f.p.id }), /正在采样/);
  f.store.save({ ...f.p, key: 'REPLACED' }); f.spending.configure(f.p.id); f.monitor.invalidate(f.p.id);
  resolve({ amount: 100, currency: 'USD', kind: 'wallet' }); await assert.rejects(start, /配置已改变/);
  assert.equal(f.spending.summary().session.status, 'idle');
});
test('changing display ratio/currency preserves history, raw baseline and running stopwatch across restart', async t => {
  const f = fixture(t); await f.spending.control({ action: 'start', siteId: f.p.id });
  f.setAmount(95); f.advance(10000); await f.monitor.refresh(f.p.id);
  const conversion = { enabled: true, rate: .2, currency: 'CNY' };
  f.store.save({ ...f.p, key: '', moneyConversion: conversion }); f.spending.configure(f.p.id); f.monitor.invalidate(f.p.id);
  assert.equal(f.spending.summary().session.status, 'running');
  assert.equal(f.spending.summary().history[0].amount, 5);
  const { convert } = require('../ui/money.js');
  assert.equal(convert(f.spending.summary().session.amount, 'USD', f.spending.summary().session).amount, 1);
  f.setAmount(94); await f.monitor.refresh(f.p.id); assert.equal(f.spending.summary().session.amount, 6); assert.equal(f.spending.summary().history[0].amount, 6);
  f.spending.shutdown(); f.restart();
  assert.deepEqual(f.spending.summary().session.moneyConversion, conversion);
  assert.equal(f.spending.summary().session.amount, 6);
  const changed = { enabled: true, rate: .05, currency: 'USD' };
  f.store.save({ ...f.store.public().sites[0], key: '', moneyConversion: changed }); f.spending.configure(f.p.id);
  assert.equal(f.spending.summary().history[0].amount, 6); assert.equal(f.spending.summary().session.status, 'paused');
  assert(Math.abs(convert(f.spending.summary().session.amount, 'USD', f.spending.summary().session).amount - .3) < 1e-12);
  f.spending.configure(f.p.id, true); f.store.remove(f.p.id);
  assert.deepEqual(f.spending.summary().session.moneyConversion, changed);
});
