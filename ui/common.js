'use strict';
window.View = {
  convert: window.MoneyConversion.convert,
  convertedResult: window.MoneyConversion.result,
  conversionNote: window.MoneyConversion.describe,
  money(value, currency = 'USD') {
    if (typeof value !== 'number') return '—';
    try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value); }
    catch { return value.toFixed(2) + ' ' + currency; }
  },
  kind: { wallet: '钱包余额', 'key-quota': '此 Key 剩余额度', 'api-balance': '账单剩余额度', subscription: '订阅窗口' },
  status(s, p) { return !p.enabled ? '已暂停自动刷新' : ({ ok: '已更新', loading: '查询中', error: '查询失败', waiting: '等待查询', unconfigured: '待配置' }[s.status] || '等待查询'); },
  result(s) { return s.snapshot || s.cached; },
  amount(r, profile) { const shown = this.convertedResult(r, profile); return r?.unlimited ? '无限额度' : r?.kind === 'subscription' ? '按窗口计费' : this.money(shown?.amount, shown?.currency); },
  time(t) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未查询'; },
  el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; },
};
