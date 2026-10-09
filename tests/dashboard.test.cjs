'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { totalInput, cacheHitRate, averageTokens, dashboardSource } = require('../ui/usage-data.js');
const { normalizeUsage, usageRange, sumStats } = require('../core/usage.cjs');
test('cache rate counts cached and uncached input once, excludes output and remains token-weighted', () => {
  const a = { requests: 2, input_tokens: 100, output_tokens: 1000, cache_creation_tokens: 20, cache_read_tokens: 80, total_tokens: 1200 };
  const b = { requests: 1, input_tokens: 10, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 90, total_tokens: 100 };
  assert.equal(totalInput(a), 200); assert.equal(cacheHitRate(a), 40); assert.equal(averageTokens(a), 600);
  assert.equal(cacheHitRate(sumStats([a, b])), 170 / 300 * 100);
  assert.equal(cacheHitRate({ input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 50 }), 100);
  assert.equal(cacheHitRate({ input_tokens: 10, cache_creation_tokens: 0, cache_read_tokens: 0 }), 0);
});
test('zero activity, missing metrics, invalid values and unsafe totals never become a misleading percentage', () => {
  for (const metrics of [null, {}, { input_tokens: 10, cache_read_tokens: 5 }, { input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }, { input_tokens: -1, cache_creation_tokens: 0, cache_read_tokens: 1 }, { input_tokens: Number.MAX_SAFE_INTEGER, cache_creation_tokens: 0, cache_read_tokens: 1 }]) assert.equal(cacheHitRate(metrics), null);
  assert.equal(averageTokens({ requests: 0, total_tokens: 0 }), null);
  assert.equal(averageTokens({ requests: null, total_tokens: 100 }), null);
  assert.equal(averageTokens({ requests: 10, total_tokens: 0 }), 0);
});
test('Sub2API daily cache_write alias is normalized and token totals require complete data', () => {
  const period = usageRange('7', Date.UTC(2026, 9, 4));
  const rows = [{ date: period.end, requests: 1, input_tokens: 100, output_tokens: 10, cache_write_tokens: 20, cache_read_tokens: 80 }];
  let daily = normalizeUsage({ daily_usage: rows }, period).daily;
  assert.equal(daily[0].cache_creation_tokens, 20); assert.equal(daily[0].total_tokens, 210); assert.equal(cacheHitRate(daily[0]), 40);
  daily = normalizeUsage({ daily_usage: [{ ...rows[0], cache_creation_tokens: 7, total_tokens: 987 }] }, period).daily;
  assert.equal(daily[0].cache_creation_tokens, 7); assert.equal(daily[0].total_tokens, 987);
  daily = normalizeUsage({ daily_usage: [{ date: period.end, input_tokens: 100, output_tokens: 10, cache_read_tokens: 80 }] }, period).daily;
  assert.equal(daily[0].total_tokens, null); assert.equal(daily[0].cache_creation_tokens, null);
  daily = normalizeUsage({ daily_usage: [{ ...rows[0], total_tokens: 'invalid', cache_creation_tokens: 'invalid' }] }, period).daily;
  assert.equal(daily[0].total_tokens, null); assert.equal(daily[0].cache_creation_tokens, null);
});
test('duplicate API profiles share the canonical source; missing and failed sources stay distinct', () => {
  const good = { id: 'a', status: 'ok' }, duplicate = { id: 'b', status: 'duplicate', duplicateOf: 'a' }, failed = { id: 'c', status: 'error' };
  const summary = { rows: [good, duplicate, failed] };
  assert.deepEqual(dashboardSource(summary, 'b'), { selected: duplicate, source: good });
  assert.equal(dashboardSource(summary, 'c').source.status, 'error');
  assert.equal(dashboardSource(summary, 'missing').source, undefined);
  assert.equal(dashboardSource({ rows: [{ ...duplicate, duplicateOf: 'removed' }] }, 'b').source, undefined);
});
