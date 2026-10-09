'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { UsageService, usageRange, normalizeUsage, sumStats, activeDates, rankModels, aggregateUsage } = require('../core/usage.cjs');
const { BalanceProvider } = require('../core/providers.cjs');
const period = usageRange('7', Date.UTC(2026, 9, 3, 1));
const daily = (date, requests, total_tokens) => ({ date, requests, total_tokens, input_tokens: 5, output_tokens: 2, cache_creation_tokens: 1, cache_read_tokens: 2 });
function source(id, days, models) { const ds = days.map(([date, calls, tokens]) => daily(date, calls, tokens)); return { id, status: 'ok', metrics: sumStats(ds), dates: activeDates(ds), daily: ds, models: rankModels(models) }; }
test('multi-site summary adds tokens but unions active dates and ranks merged model calls', () => {
  const rows = [source('a', [['2026-10-01', 8, 100], ['2026-10-02', 3, 70]], [{ model: 'shared', requests: 6, total_tokens: 80 }, { model: 'a-only', requests: 7, total_tokens: 90 }]),
    source('b', [['2026-10-02', 4, 90], ['2026-10-03', 1, 30]], [{ model: 'shared', requests: 6, total_tokens: 60 }, { model: 'b-only', requests: 8, total_tokens: 60 }])];
  const total = aggregateUsage(rows, period);
  assert.equal(total.totals.total_tokens, 290); assert.equal(total.totals.requests, 16); assert.equal(total.activeDays, 3);
  assert.equal(total.favorite, 'shared'); assert.equal(total.models[0].requests, 12); assert.equal(total.models[0].total_tokens, 140);
});
test('missing, invalid and zero statistics remain distinct; out-of-range days cannot enter totals', () => {
  const absent = normalizeUsage({ balance: 56 }, period); assert.equal(absent.daily, null); assert.equal(absent.total.total_tokens, null); assert.equal(absent.models, null);
  const value = normalizeUsage({ daily_usage: [daily('2026-10-03', 0, 0), daily('2026-09-01', 99, 9900)], usage: { total: { total_tokens: false, requests: ' ' } } }, period);
  assert.equal(sumStats(value.daily).total_tokens, 0); assert.deepEqual(activeDates(value.daily), []); assert.equal(value.total.requests, null);
  assert.equal(normalizeUsage({ daily_usage: [daily('2026-10-03', 1, 2), daily('2026-10-03', 1, 2)] }, period).daily, null);
  const total = aggregateUsage([source('a', [['2026-10-03', 1, 100]], []), { status: 'error' }, { status: 'unsupported' }], period);
  assert.equal(total.totals.total_tokens, 100); assert.equal(total.metricCoverage.total_tokens, 1); assert.equal(total.sources, 3);
  assert.equal(aggregateUsage([{ status: 'unsupported' }], period).totals.total_tokens, null);
});
test('statistics request stays read-only on configured origin and excludes raw response fields and echoed keys', async () => {
  let request;
  const provider = new BalanceProvider(async (url, options) => {
    request = { url: new URL(url), options };
    return new Response(JSON.stringify({ usage: { total: { total_tokens: 150 } }, model_stats: [{ model: 'echo-SECRET-KEY', requests: 1 }], private_email: 'do-not-export@example.invalid' }), { headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.queryUsage({ provider: 'sub2api', baseUrl: 'https://example.invalid/v1' }, 'SECRET-KEY', period);
  assert.equal(request.url.origin, 'https://example.invalid'); assert.equal(request.url.pathname, '/v1/usage'); assert.equal(request.url.searchParams.get('days'), '7');
  assert.equal(request.url.searchParams.get('start_date'), '2026-09-27'); assert.equal(request.options.method, 'GET'); assert.equal(request.options.redirect, 'error');
  assert(!JSON.stringify(result).includes('SECRET-KEY')); assert(!JSON.stringify(result).includes('do-not-export'));
});
function fixture(n = 3) {
  const profiles = Array.from({ length: n }, (_, i) => ({ id: String(i), name: 'site' + i, revision: 1, provider: 'sub2api', baseUrl: 'https://example.invalid', keyCipher: 'key-' + i }));
  return { data: { sites: profiles }, key: p => p.keyCipher, get: id => profiles.find(p => p.id === id) };
}
test('same-origin duplicate key is queried and included once; distinct keys remain separate; queries are bounded to three', async () => {
  const store = fixture(7); store.data.sites[1].keyCipher = 'key-0'; store.data.sites[6].provider = 'billing';
  let running = 0, peak = 0, calls = 0;
  const service = new UsageService(store, { queryUsage: async (_p, _k, p) => { calls++; running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 10)); running--; return normalizeUsage({ usage: { total: { total_tokens: 100 } }, daily_usage: [], model_stats: [] }, p); } });
  const result = await service.query('all');
  assert.equal(calls, 5); assert.equal(peak, 3); assert.equal(result.rows[1].status, 'duplicate'); assert.equal(result.rows[6].status, 'unsupported');
  assert.equal(result.rows[1].duplicateOf, '0');
  assert.equal(result.totals.total_tokens, 500); assert.equal(result.sources, 6); assert.equal(result.activeDays, 0);
});
test('7/30/90 totals use daily records, lifetime is separate, failures and changed profiles never contribute', async () => {
  const store = fixture(1), service = new UsageService(store, { queryUsage: async (_p, _k, p) => normalizeUsage({ usage: { total: { total_tokens: 9999 } }, daily_usage: [daily(p.end, 1, 80)] }, p) });
  assert.equal((await service.query('7')).totals.total_tokens, 80); assert.equal((await service.query('all')).totals.total_tokens, 9999);
  const late = new UsageService(store, { queryUsage: async (_p, _k, p) => { store.data.sites[0].revision++; return normalizeUsage({ usage: { total: { total_tokens: 9999 } } }, p); } });
  assert.equal((await late.query('all')).totals.total_tokens, null);
  const failed = new UsageService(store, { queryUsage: async () => { throw Object.assign(new Error('连接超时'), { code: 'NETWORK' }); } });
  assert.equal((await failed.query('30')).rows[0].status, 'error'); assert.throws(() => usageRange('365'), /无效/);
  assert.equal(usageRange('7', Date.UTC(2026, 9, 2, 16, 1)).end, '2026-10-03');
});
