'use strict';
// Shared arithmetic for the dashboard and its Node tests. No credentials or network.
(() => {
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  function totalInput(metrics) {
    const values = ['input_tokens', 'cache_creation_tokens', 'cache_read_tokens'].map(k => metrics?.[k]);
    if (!values.every(valid)) return null;
    const sum = values.reduce((n, v) => n + v, 0);
    return Number.isSafeInteger(sum) ? sum : null;
  }
  function cacheHitRate(metrics) {
    const input = totalInput(metrics);
    return input == null || input === 0 ? null : metrics.cache_read_tokens / input * 100;
  }
  function averageTokens(metrics) {
    return valid(metrics?.requests) && metrics.requests > 0 && valid(metrics?.total_tokens) ? metrics.total_tokens / metrics.requests : null;
  }
  function dashboardSource(summary, id) {
    const selected = summary.rows.find(row => row.id === id);
    const source = selected?.status === 'duplicate' ? summary.rows.find(row => row.id === selected.duplicateOf && row.status !== 'duplicate') : selected;
    return { selected, source };
  }
  const api = { totalInput, cacheHitRate, averageTokens, dashboardSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.UsageData = api;
})();
