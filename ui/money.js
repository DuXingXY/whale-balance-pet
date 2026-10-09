'use strict';
// Shared by Electron's main process and the sandboxed views. Conversion is
// presentation only: recorded amounts and consumption baselines stay raw.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoneyConversion = factory();
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function convert(amount, currency, profile) {
    const c = profile?.moneyConversion;
    if (!c?.enabled) return { amount, currency, converted: false };
    const value = Number.isFinite(amount) && Number.isFinite(c.rate) && c.rate > 0 ? amount * c.rate : null;
    return { amount: Number.isFinite(value) ? value : null, currency: c.currency, converted: true };
  }
  function result(record, profile) {
    if (!record) return record;
    const shown = convert(record.amount, record.currency, profile);
    return { ...record, ...shown, used: convert(record.used, record.currency, profile).amount,
      windows: (record.windows || []).map(w => ({ ...w, used: convert(w.used, record.currency, profile).amount, limit: convert(w.limit, record.currency, profile).amount })) };
  }
  function describe(currency, profile) {
    const c = profile?.moneyConversion;
    return c?.enabled ? `1 ${currency || '接口金额单位'} = ${c.rate} ${c.currency} · 按本站比例换算` : '接口原始金额';
  }
  return { convert, result, describe };
});
