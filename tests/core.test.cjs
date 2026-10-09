'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Store } = require('../core/store.cjs'); const { BalanceProvider, readBoundedJsonText, numeric } = require('../core/providers.cjs'); const { Monitor } = require('../core/monitor.cjs');
function input(extra = {}) { return { name: '站点 A', baseUrl: 'https://a.example', key: 'TEST-KEY-A', provider: 'sub2api', ...extra }; }
function store(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-unit-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return new Store(dir, { encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString() }); }
function json(d, status = 200) { return new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } }); }
function profile(extra) { const s = new Store('unused', {}); return require('../core/profiles.cjs').validateProfile(input(extra)); }
const result = amount => ({ amount, kind: 'wallet', currency: 'USD', used: null, windows: [], unlimited: false });
test('multiple credentials stay separate, public views redact keys, domain replacement requires a new key', t => {
  const s = store(t), a = s.save(input()), b = s.save(input({ name: 'B', baseUrl: 'https://b.example', key: 'TEST-KEY-B' }));
  assert.equal(s.key(s.get(a.id)), 'TEST-KEY-A'); assert.equal(s.key(s.get(b.id)), 'TEST-KEY-B');
  assert(!JSON.stringify(s.public()).includes('TEST-KEY')); assert(!JSON.stringify(s.public()).includes('keyCipher'));
  assert(!fs.readFileSync(s.file, 'utf8').includes('TEST-KEY'));
  s.save({ ...a, key: '', name: 'A2' }); assert.equal(s.key(s.get(a.id)), 'TEST-KEY-A');
  assert.throws(() => s.save({ ...a, baseUrl: 'https://evil.example', key: '' }), /新站点/);
  s.save({ ...a, baseUrl: 'https://new.example', key: 'NEW-KEY' }); assert.equal(s.key(s.get(a.id)), 'NEW-KEY'); assert.equal(s.key(s.get(b.id)), 'TEST-KEY-B');
});
test('wallet zero is valid; null, boolean, key quotas and subscriptions never become wallet amounts', async () => {
  assert.equal(numeric(null), null); assert.equal(numeric(false), null); assert.equal(numeric([]), null); assert.equal(numeric('  '), null);
  assert.equal((await new BalanceProvider(async () => json({ mode: 'unrestricted', balance: 0, unit: 'USD' })).query(profile(), 'K')).amount, 0);
  await assert.rejects(new BalanceProvider(async () => json({ mode: 'unrestricted', balance: null, remaining: 55 })).query(profile(), 'K'), /钱包/);
  const quota = await new BalanceProvider(async () => json({ mode: 'quota_limited', quota: { remaining: 9, used: 1 } })).query(profile(), 'K'); assert.equal(quota.kind, 'key-quota'); assert.equal(quota.amount, 9);
  const sub = await new BalanceProvider(async () => json({ subscription: { daily_limit_usd: 10, daily_usage_usd: 3 }, remaining: -1 })).query(profile(), 'K'); assert.equal(sub.kind, 'subscription'); assert.equal(sub.amount, null); assert.equal(sub.windows[0].used, 3);
});
test('billing cents conversion and raw token quota conversions are explicit', async () => {
  const provider = new BalanceProvider(async url => json(url.endsWith('subscription') ? { hard_limit_usd: 100 } : { total_usage: 250 }));
  assert.deepEqual((await provider.query(profile({ provider: 'billing' }), 'K')).amount, 97.5);
  const q = await new BalanceProvider(async () => json({ data: { remain_quota: 500000, used_quota: 250000 } })).query(profile({ provider: 'newapi' }), 'K'); assert.equal(q.amount, 1); assert.equal(q.used, .5);
  const u = await new BalanceProvider(async () => json({ data: { unlimited_quota: true } })).query(profile({ provider: 'newapi' }), 'K'); assert.equal(u.amount, null); assert.equal(u.unlimited, true);
});
test('custom response mapping, authentication and read-only POST work without redirecting the key', async () => {
  const p = profile({ provider: 'custom', custom: { path: '/balance', method: 'POST', auth: 'header', header: 'X-Key', body: '{"scope":"balance"}', balanceField: 'data.items[0].left', scale: .01 } });
  const provider = new BalanceProvider(async (url, opts) => { assert.equal(url, 'https://a.example/balance'); assert.equal(opts.headers['X-Key'], 'K'); assert.equal(opts.redirect, 'error'); assert.equal(opts.body, '{"scope":"balance"}'); return json({ data: { items: [{ left: 123 }] } }); });
  assert.equal((await provider.query(p, 'K')).amount, 1.23);
  await assert.rejects(provider.json(p, 'https://b.example/balance', 'K'), /同域/);
  assert.throws(() => profile({ custom: { balanceField: '__proto__.balance' } }), /字段/);
  assert.throws(() => profile({ custom: { path: '//b.example/balance' } }), /本站/);
});
test('remote errors are redacted; HTML, invalid amounts and oversized streams fail explicitly', async () => {
  await assert.rejects(new BalanceProvider(async () => json({ message: 'KEY-secret' }, 401)).query(profile(), 'KEY-secret'), e => e.code === 'HTTP_401' && !e.message.includes('secret'));
  await assert.rejects(new BalanceProvider(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })).query(profile(), 'K'), /网页/);
  await assert.rejects(readBoundedJsonText(new Response('x'.repeat(1025)), 1024), /过大/);
  await assert.rejects(new BalanceProvider(async () => json({ balance: false })).query(profile(), 'K'), /钱包/);
});
test('observed decreases survive recharge; low threshold notifies once until replenished; errors retain last values', async t => {
  const s = store(t), p = s.save(input({ threshold: 5 })); let value = 10, fails = false, notices = 0;
  const m = new Monitor(s, { query: async () => { if (fails) throw Object.assign(new Error('断网'), { code: 'NETWORK' }); return result(value); } }, { notify: () => notices++, now: () => Date.UTC(2026, 9, 2, 12) });
  await m.refresh(p.id); value = 4; await m.refresh(p.id); await m.refresh(p.id); assert.equal(notices, 1); assert.equal(m.state(p.id).decrease, 6);
  value = 14; await m.refresh(p.id); value = 2; await m.refresh(p.id); assert.equal(notices, 2); assert.equal(m.state(p.id).decrease, 18);
  fails = true; await m.refresh(p.id); assert.equal(m.state(p.id).status, 'error'); assert.equal(m.state(p.id).cached.amount, 2);
});
test('three concurrent site queries, per-key results and disabled site scheduling', async t => {
  const s = store(t); for (let i = 0; i < 5; i++) s.save(input({ name: 'site' + i, key: 'KEY-' + i, enabled: i !== 4 }));
  let running = 0, peak = 0; const seen = [];
  const m = new Monitor(s, { query: async (p, key) => { running++; peak = Math.max(peak, running); seen.push([p.name, key]); await new Promise(r => setTimeout(r, 20)); running--; return result(Number(key.slice(-1))); } });
  m.tick(); await Promise.all([...m.jobs.values()].map(j => j.promise)); assert.equal(peak, 3); assert.equal(seen.length, 4);
  for (let i = 0; i < 4; i++) { const p = s.data.sites[i]; assert.equal(m.state(p.id).snapshot.amount, i); }
  assert.equal(m.state(s.data.sites[4].id).status, 'waiting');
});
test('late responses after changing/deleting a site are discarded', async t => {
  const s = store(t), p = s.save(input()); let complete; const m = new Monitor(s, { query: () => new Promise(r => complete = r) });
  const first = m.refresh(p.id); s.save({ ...p, key: 'CHANGED' }); m.invalidate(p.id); complete(result(999)); await first;
  assert.equal(m.state(p.id).snapshot, undefined); assert.equal(m.state(p.id).cached, undefined);
  const second = m.refresh(p.id); m.invalidate(p.id); s.remove(p.id); complete(result(999)); await second; assert.equal(m.all()[p.id], undefined); assert.equal(m.books[p.id], undefined);
});

test('editing a paused site starts a new query before its cancelled request settles', async t => {
  const s = store(t), p = s.save(input({ enabled: false })), pending = [];
  const m = new Monitor(s, { query: (profile, key, signal) => new Promise(resolve => pending.push({ profile, key, signal, resolve })) });
  const old = m.refresh(p.id);
  s.save({ ...p, key: 'NEW-KEY', name: '更新的站点' }); m.invalidate(p.id);
  const fresh = m.refresh(p.id);
  assert.notEqual(fresh, old); assert.equal(pending.length, 2);
  assert(pending[0].signal.aborted); assert.equal(pending[1].key, 'NEW-KEY');
  pending[0].resolve(result(999)); await old;
  assert.equal(m.refresh(p.id), fresh, 'old completion cannot remove the new job');
  assert.equal(m.state(p.id).cached, undefined);
  pending[1].resolve(result(42)); await fresh;
  assert.equal(m.state(p.id).status, 'ok'); assert.equal(m.state(p.id).snapshot.amount, 42);
});

test('editing a queued site releases its old waiters and queries only its new configuration', async t => {
  const s = store(t), sites = Array.from({ length: 4 }, (_, i) => s.save(input({ name: 'S' + i, key: 'K' + i, enabled: false })));
  const pending = [], calls = [];
  const m = new Monitor(s, { query: (p, key) => { calls.push(key); return new Promise(resolve => pending.push(resolve)); } });
  const active = sites.slice(0, 3).map(p => m.refresh(p.id)), p = sites[3], queued = m.refresh(p.id);
  s.save({ ...p, key: 'REPLACED' }); m.invalidate(p.id);
  await queued;
  const fresh = m.refresh(p.id); assert.equal(m.queue.length, 1);
  pending[0](result(1)); await active[0];
  assert.deepEqual(calls, ['K0', 'K1', 'K2', 'REPLACED']); assert.equal(m.active, 3);
  pending.slice(1).forEach(resolve => resolve(result(2))); await Promise.all([...active.slice(1), fresh]);
  assert.equal(m.state(p.id).snapshot.amount, 2); assert.equal(m.active, 0);
});
