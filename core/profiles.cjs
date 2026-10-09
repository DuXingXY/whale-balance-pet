'use strict';
const crypto = require('node:crypto');
const PROVIDERS = ['sub2api', 'billing', 'newapi', 'deepseek', 'openrouter', 'moonshot', 'custom'];
const BLOCKED_FIELDS = ['__proto__', 'constructor', 'prototype'];
function cleanUrl(value) {
  let u; try { u = new URL(String(value || '').trim()); } catch { throw new Error('请填写完整站点地址，例如 https://www.bb-api.com'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('站点须使用 HTTPS，本机服务可以使用 HTTP');
  if (u.username || u.password || u.search || u.hash) throw new Error('站点地址不能包含密码、查询参数或片段');
  return u.href.replace(/\/+$/, '');
}
function num(v, min, max, name) { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(name + '超出有效范围'); return n; }
function fieldPath(v) {
  const s = String(v || '').trim();
  if (s.length > 200 || (s && !/^[\w.\[\]]+$/.test(s)) || s.replace(/\[(\d+)\]/g, '.$1').split('.').some(x => BLOCKED_FIELDS.includes(x))) throw new Error('JSON 字段路径无效');
  return s;
}
function validateProfile(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('站点设置无效');
  const provider = input.provider || 'sub2api';
  if (!PROVIDERS.includes(provider)) throw new Error('请选择有效的余额接口类型');
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) throw new Error('请填写站点名称');
  const baseUrl = cleanUrl(input.baseUrl);
  const currency = String(input.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('币种请使用 USD、CNY 等三位代码');
  const c = input.custom || {};
  const conversion = input.moneyConversion ?? previous?.moneyConversion ?? { enabled: false, rate: 1, currency: 'USD' };
  if (!conversion || typeof conversion !== 'object' || Array.isArray(conversion)) throw new Error('金额转换设置无效');
  if (!['USD', 'CNY'].includes(conversion.currency ?? 'USD')) throw new Error('显示币种请选择美元或人民币');
  if (typeof (conversion.enabled ?? false) !== 'boolean') throw new Error('金额转换开关无效');
  const moneyConversion = { enabled: conversion.enabled ?? false, rate: num(conversion.rate ?? 1, 1e-9, 1e9, '金额转换比例'), currency: conversion.currency ?? 'USD' };
  const custom = {
    path: String(c.path || '/v1/usage').trim(), method: c.method || 'GET', auth: c.auth || 'bearer',
    header: String(c.header || 'x-api-key').trim(), balanceField: fieldPath(c.balanceField || 'balance'),
    usedField: fieldPath(c.usedField || ''), scale: num(c.scale ?? 1, 1e-9, 1e12, '金额倍率'),
    kind: c.kind || 'wallet', body: String(c.body || ''),
  };
  if (custom.path.length > 1000 || !custom.path.startsWith('/') || custom.path.startsWith('//') || /[\\\r\n#]/.test(custom.path) || /(?:key|token|password)=/i.test(custom.path)) throw new Error('余额路径须是本站路径，且不能包含密钥');
  if (!['GET', 'POST'].includes(custom.method) || !['bearer', 'header', 'raw', 'none'].includes(custom.auth) || !['wallet', 'key-quota'].includes(custom.kind)) throw new Error('自定义接口设置无效');
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,59}$/.test(custom.header) || /^(host|cookie|origin|referer|connection|content-length)$/i.test(custom.header)) throw new Error('自定义认证请求头无效');
  if (custom.body.length > 10000) throw new Error('查询参数过长');
  if (custom.body) { try { JSON.parse(custom.body); } catch { throw new Error('POST 查询参数必须是有效 JSON'); } }
  let key = String(input.key || '').trim().replace(/^Bearer\s+/i, '');
  if (key.length > 8192 || /[\r\n]/.test(key)) throw new Error('Key 格式无效');
  if (previous && new URL(previous.baseUrl).origin !== new URL(baseUrl).origin && !key) throw new Error('更换站点域名时请同时填写新站点的 Key');
  const needsKey = provider !== 'custom' || custom.auth !== 'none';
  if (needsKey && !key && !previous?.keyCipher) throw new Error('请填写该站点的 API Key');
  return {
    id: previous?.id || crypto.randomUUID(), name, baseUrl, provider, currency, moneyConversion,
    interval: num(input.interval ?? 60, 30, 3600, '刷新间隔'),
    threshold: num(input.threshold ?? 5, 0, 1e9, '提醒阈值'),
    alert: input.alert !== false, enabled: input.enabled !== false, custom,
    billingDivisor: num(input.billingDivisor ?? 100, 1e-6, 1e12, '账单用量除数'),
    quotaPerUnit: num(input.quotaPerUnit ?? 500000, 1e-6, 1e12, '额度换算单位'),
    dashboardUrl: input.dashboardUrl ? cleanUrl(input.dashboardUrl) : new URL(baseUrl).origin,
    keyCipher: previous?.keyCipher || '', revision: (previous?.revision || 0) + 1,
    key,
  };
}
function publicProfile(p) { const { keyCipher, key, ...value } = p; return { ...value, hasKey: !!keyCipher }; }
module.exports = { validateProfile, publicProfile, cleanUrl, PROVIDERS };
