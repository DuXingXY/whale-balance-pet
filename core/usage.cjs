'use strict';
const { createHash } = require('node:crypto');
const METRICS = ['requests', 'total_tokens', 'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'];
const count = value => {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
function stats(value) {
  const result = Object.fromEntries(METRICS.map(k => [k, count(value?.[k])]));
  // Sub2API daily rows call cache creation "cache_write_tokens".
  if (value && !Object.hasOwn(value, 'cache_creation_tokens')) result.cache_creation_tokens = count(value.cache_write_tokens);
  if (value && !Object.hasOwn(value, 'total_tokens')) {
    const tokens = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'].map(k => result[k]);
    const total = tokens.reduce((sum, n) => sum + (n ?? 0), 0);
    if (tokens.every(n => n != null) && Number.isSafeInteger(total)) result.total_tokens = total;
  }
  return result;
}
function dateString(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function usageRange(range = '30', now = Date.now()) {
  if (!['all', '7', '30', '90'].includes(range)) throw new Error('用量时间范围无效');
  const days = range === 'all' ? 90 : Number(range), end = dateString(new Date(now));
  const start = new Date(end + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - days + 1);
  return { range, days, start: start.toISOString().slice(0, 10), end, timezone: 'Asia/Hong_Kong' };
}
function normalizeUsage(payload, period, safeName = s => s) {
  let daily = null;
  if (Array.isArray(payload.daily_usage) && payload.daily_usage.length <= 90) {
    const seen = new Set(); let valid = true;
    daily = payload.daily_usage.map(row => {
      const date = row?.date;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || seen.has(date)) valid = false;
      seen.add(date); return { date, ...stats(row) };
    }).filter(row => row.date >= period.start && row.date <= period.end);
    if (!valid) daily = null;
  }
  const models = Array.isArray(payload.model_stats) && payload.model_stats.length <= 2000 && payload.model_stats.every(row => typeof row?.model === 'string' && row.model.trim()) ? payload.model_stats.map(row => ({ model: safeName(row.model).slice(0, 160), ...stats(row) })) : null;
  return { total: stats(payload.usage?.total), daily, models, period };
}
function sumStats(items) {
  return Object.fromEntries(METRICS.map(k => {
    const values = items.map(r => r[k]); const sum = values.reduce((n, v) => n + (v ?? 0), 0);
    return [k, values.some(v => v == null) || !Number.isSafeInteger(sum) ? null : sum];
  }));
}
function activeDates(daily) {
  if (!daily || daily.some(d => d.requests == null && d.total_tokens == null)) return null;
  return daily.filter(d => d.requests > 0 || d.total_tokens > 0).map(d => d.date);
}
function rankModels(models) {
  if (!models) return null;
  const grouped = new Map();
  for (const row of models) { const rows = grouped.get(row.model) || []; rows.push(row); grouped.set(row.model, rows); }
  return [...grouped].map(([model, rows]) => ({ model, ...sumStats(rows) })).sort((a, b) => (b.requests ?? -1) - (a.requests ?? -1) || a.model.localeCompare(b.model));
}
function favorite(models) { return !models || models.some(m => m.requests == null) ? null : models.find(m => m.requests > 0)?.model || null; }
function aggregateUsage(rows, period) {
  const valid = rows.filter(row => row.status === 'ok');
  const metricCoverage = {}, totals = {};
  for (const k of METRICS) {
    const values = valid.map(row => row.metrics[k]).filter(v => v != null);
    metricCoverage[k] = values.length; const sum = values.reduce((a, b) => a + b, 0);
    totals[k] = values.length && Number.isSafeInteger(sum) ? sum : null;
  }
  const dated = valid.filter(row => row.dates != null), dates = [...new Set(dated.flatMap(row => row.dates))].sort();
  const modeled = valid.filter(row => row.models != null), models = rankModels(modeled.flatMap(row => row.models));
  const dayMap = new Map();
  for (const row of dated) for (const d of row.daily) { const entries = dayMap.get(d.date) || []; entries.push(d); dayMap.set(d.date, entries); }
  return { period, rows, totals, metricCoverage, activeDays: dated.length ? dates.length : null, activeCoverage: dated.length,
    favorite: modeled.length ? favorite(models) : null, modelCoverage: modeled.length, models,
    daily: [...dayMap].map(([date, entries]) => ({ date, ...sumStats(entries) })).sort((a, b) => a.date.localeCompare(b.date)),
    included: valid.length, sources: rows.filter(row => row.status !== 'duplicate').length };
}
class UsageService {
  constructor(store, provider) { this.store = store; this.provider = provider; }
  async query(range) {
    const period = usageRange(range), profiles = structuredClone(this.store.data.sites), seen = new Map(), rows = new Array(profiles.length); let index = 0;
    // Credential identities never leave the main process. A shared wallet is not summed here.
    const jobs = profiles.map((p, i) => {
      if (p.provider !== 'sub2api') { rows[i] = { id: p.id, name: p.name, status: 'unsupported', error: '此余额适配器尚未提供 Token / 模型用量接口' }; return null; }
      try {
        const key = this.store.key(p);
        if (!key) { rows[i] = { id: p.id, name: p.name, status: 'unconfigured', error: '请先保存 API Key' }; return null; }
        const identity = new URL(p.baseUrl).origin + ':' + createHash('sha256').update(key).digest('hex');
        if (seen.has(identity)) { const original = seen.get(identity); rows[i] = { id: p.id, name: p.name, status: 'duplicate', duplicateOf: original.id, error: '相同站点与 Key，已并入“' + original.name + '”' }; return null; }
        seen.set(identity, { id: p.id, name: p.name }); return { p, key, i };
      } catch { rows[i] = { id: p.id, name: p.name, status: 'error', error: '无法读取本机凭据，请重新保存 Key' }; return null; }
    }).filter(Boolean);
    const worker = async () => {
      while (index < jobs.length) {
        const { p, key, i } = jobs[index++];
        try {
          const usage = await this.provider.queryUsage(p, key, period);
          if (this.store.get(p.id)?.revision !== p.revision) { rows[i] = { id: p.id, name: p.name, status: 'error', error: '设置已变更，请刷新用量' }; continue; }
          const metrics = period.range === 'all' ? usage.total : usage.daily ? sumStats(usage.daily) : stats(null);
          const dates = activeDates(usage.daily), models = rankModels(usage.models);
          const supported = METRICS.some(k => metrics[k] != null) || dates != null || models != null;
          rows[i] = { id: p.id, name: p.name, status: supported ? 'ok' : 'unsupported', error: supported ? '' : '接口未提供所选范围的用量统计', metrics, dates, models, daily: usage.daily, favorite: favorite(models) };
        } catch (e) { rows[i] = { id: p.id, name: p.name, status: 'error', error: e.code ? e.message : '用量读取失败，请稍后重试', code: e.code || 'USAGE_ERROR', details: e.code ? e.details : {} }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    return { ...aggregateUsage(rows, period), checkedAt: Date.now() };
  }
}
module.exports = { UsageService, usageRange, normalizeUsage, sumStats, activeDates, rankModels, aggregateUsage, count };
