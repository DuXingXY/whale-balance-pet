'use strict';
// Adapted from MeteorNOX/DeepSeek-Balance-Whale-Widget, For-Codex
// runtime/providers.mjs @ 5a36d6442d272cd7fea255206f2abcd697a87563 (MIT).
// Retains bounded responses, numeric/field parsing and billing/key-quota adapters.
class ProviderError extends Error { constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; } }
function diagnosticText(value, key) {
  if (!['string', 'number'].includes(typeof value)) return undefined;
  let text = String(value);
  if (key) for (const secret of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]) text = text.split(secret).join('[已隐藏 Key]');
  return text.replace(/Bearer\s+(?!\[已隐藏)[^\s"',;]+/gi, 'Bearer [已隐藏 Key]')
    .replace(/\bsk-[\w-]+/gi, '[已隐藏 Key]')
    .replace(/((?:api[_-]?key|token|password|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 1200);
}
function serverDetails(data, key) {
  if (!data || typeof data !== 'object') return {};
  const error = data.error && typeof data.error === 'object' ? data.error : {};
  const out = {};
  for (const [name, value] of Object.entries({ server_code: error.code ?? data.code ?? data.error_code, server_type: error.type, server_message: error.message ?? data.message ?? data.msg ?? (typeof data.error === 'string' ? data.error : undefined) })) {
    const safe = diagnosticText(value, key); if (safe !== undefined) out[name] = safe;
  }
  return out;
}
function numeric(v) { if (!['number', 'string'].includes(typeof v) || (typeof v === 'string' && !v.trim())) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function field(data, path) {
  let cur = data;
  for (const part of String(path).replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!cur || !Object.hasOwn(cur, part)) return null; cur = cur[part];
  }
  return numeric(cur);
}
async function readBoundedJsonText(response, limit = 1024 * 1024) {
  const cancel = async () => { try { await response.body?.cancel(); } catch {} };
  if (Number(response.headers.get('content-length')) > limit) { await cancel(); throw new ProviderError('SHAPE', '接口响应过大'); }
  if (!response.body?.getReader) { await cancel(); throw new ProviderError('SHAPE', '接口响应流无效'); }
  const reader = response.body.getReader(), chunks = []; let count = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength;
      if (count > limit) { await reader.cancel(); throw new ProviderError('SHAPE', '接口响应过大'); }
      chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks, count).toString('utf8');
  } finally { reader.releaseLock(); }
}
class BalanceProvider {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; }
  async queryUsage(p, key, period) {
    const params = new URLSearchParams({ days: String(period.days), start_date: period.start, end_date: period.end, timezone: period.timezone });
    try {
      const payload = await this.json(p, '/v1/usage?' + params, key);
      return require('./usage.cjs').normalizeUsage(payload, period, name => diagnosticText(name, key) || '未命名模型');
    } catch (e) { if (e instanceof ProviderError) e.message = e.message.replaceAll('余额', '用量'); throw e; }
  }
  async json(profile, path, key, { method = 'GET', auth = 'bearer', header = 'x-api-key', body = '', signal } = {}) {
    const base = new URL(profile.baseUrl), url = new URL(path, base.origin);
    if (url.origin !== base.origin) throw new ProviderError('CONFIG', '查询接口必须与站点地址同域');
    const headers = { Accept: 'application/json' };
    if (auth === 'bearer') headers.Authorization = 'Bearer ' + key;
    if (auth === 'raw') headers.Authorization = key;
    if (auth === 'header') headers[header] = key;
    if (body && method === 'POST') headers['Content-Type'] = 'application/json';
    let response;
    try { response = await this.fetch(url.href, { method, headers, ...(body && method === 'POST' ? { body } : {}), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }); }
    catch (e) { throw new ProviderError('NETWORK', '网络连接失败或超时，请稍后重试', { endpoint: diagnosticText(url.origin + url.pathname, key), method, network_error: diagnosticText(e.cause?.code || e.name, key), network_cause: diagnosticText(e.cause?.name, key) }); }
    const details = { endpoint: diagnosticText(url.origin + url.pathname, key), method, http_status: response.status, response_type: diagnosticText(response.headers.get('content-type') || '(未提供)', key), request_id: diagnosticText(response.headers.get('x-request-id') || response.headers.get('cf-ray'), key) };
    if (!response.ok) {
      let server = {};
      try { if ((response.headers.get('content-type') || '').includes('json')) server = serverDetails(JSON.parse(await readBoundedJsonText(response, 65536)), key); else await response.body?.cancel(); } catch { /* Keep the HTTP diagnosis when its error body is invalid. */ }
      const code = response.status;
      const message = code === 401 ? 'Key 无效或无权查询余额（401）' : code === 403 ? (profile.provider === 'openrouter' ? '余额查询需要 OpenRouter 管理 Key（403）' : '访问被拒绝，请检查 Key / 分组 / IP 限制（403）') : code === 429 ? '查询过于频繁，请稍后重试（429）' : '余额接口返回 HTTP ' + code;
      throw new ProviderError('HTTP_' + code, message, { ...details, ...server });
    }
    if (!(response.headers.get('content-type') || '').includes('json')) { try { await response.body?.cancel(); } catch {} throw new ProviderError('NOT_JSON', '接口返回了网页或验证页，请核对余额接口', details); }
    let data; try { data = JSON.parse(await readBoundedJsonText(response)); }
    catch (e) { if (e instanceof ProviderError) { e.details = { ...details, ...e.details }; throw e; } throw new ProviderError('SHAPE', '接口返回的 JSON 无法解析', details); }
    if (!data || typeof data !== 'object' || data.success === false || data.ok === false || data.status === false || data.isValid === false || (data.code != null && ![true, 0, 200, '0', '200'].includes(data.code))) throw new ProviderError('API_ERROR', '服务商拒绝查询，请检查 Key 与接口设置', { ...details, ...serverDetails(data, key) });
    return data;
  }
  async query(p, key, signal) {
    let context = { adapter: p.provider };
    const json = (path, opts) => { const url = new URL(path, new URL(p.baseUrl).origin); context = { adapter: p.provider, endpoint: diagnosticText(url.origin + url.pathname, key), method: opts?.method || 'GET' }; return this.json(p, path, key, { signal, ...opts }); };
    try {
    let amount = null, used = null, kind = 'wallet', currency = p.currency, windows = [], unlimited = false;
    if (p.provider === 'sub2api') {
      const d = await json('/v1/usage');
      if (/^[A-Z]{3}$/.test(d.unit)) currency = d.unit;
      if (d.mode === 'quota_limited') {
        kind = 'key-quota'; amount = numeric(d.quota?.remaining); used = numeric(d.quota?.used);
        windows = (Array.isArray(d.rate_limits) ? d.rate_limits : []).slice(0, 12).map(w => ({ label: ['5h', '1d', '7d'].includes(w.window) ? w.window : '窗口', used: numeric(w.used), limit: numeric(w.limit), reset: typeof w.reset_at === 'string' && /^\d{4}-/.test(w.reset_at) ? w.reset_at : null }));
        if (amount == null && !windows.length) throw new ProviderError('SHAPE', '此 Key 未返回可读取的额度');
      } else if (d.subscription || (d.planName && d.balance == null)) {
        kind = 'subscription';
        for (const [k, label] of [['daily', '日'], ['weekly', '周'], ['monthly', '月']]) {
          const limit = numeric(d.subscription?.[k + '_limit_usd']), u = numeric(d.subscription?.[k + '_usage_usd']);
          if (limit != null && limit > 0) windows.push({ label, used: u, limit });
        }
        if (!windows.length) throw new ProviderError('NO_PLAN', '此 Key 未返回有效订阅窗口');
      } else { amount = numeric(d.balance); if (amount == null) throw new ProviderError('SHAPE', '接口未提供钱包余额，不能把其他额度当作余额'); }
    } else if (p.provider === 'billing') {
      const root = new URL(p.baseUrl).pathname.replace(/\/$/, '');
      const prefix = /\/v1$/.test(root) ? root : root + '/v1';
      const [s, u] = await Promise.all([json(prefix + '/dashboard/billing/subscription'), json(prefix + '/dashboard/billing/usage')]);
      const total = numeric(s.hard_limit_usd), raw = numeric(u.total_usage);
      if (total == null || raw == null || raw < 0) throw new ProviderError('SHAPE', '账单接口缺少有效额度 / 已用字段');
      used = raw / p.billingDivisor; amount = total - used; currency = 'USD'; kind = 'api-balance';
    } else if (p.provider === 'newapi') {
      const payload = await json('/api/usage/token/'), d = payload.data || payload;
      kind = 'key-quota'; unlimited = d.unlimited_quota === true;
      // New API returns raw quota in both total_* and legacy *_quota fields.
      if (numeric(d.total_available) != null && numeric(d.total_used) != null) { amount = numeric(d.total_available) / p.quotaPerUnit; used = numeric(d.total_used) / p.quotaPerUnit; }
      else { const q = numeric(d.remain_quota); amount = q == null ? null : q / p.quotaPerUnit; const u = numeric(d.used_quota); used = u == null ? null : u / p.quotaPerUnit; }
      if (unlimited) amount = null;
    } else if (p.provider === 'deepseek') {
      const d = await json('/user/balance'); const info = d.balance_infos?.find(i => i.currency === p.currency) || d.balance_infos?.[0];
      amount = numeric(info?.total_balance); if (/^[A-Z]{3}$/.test(info?.currency)) currency = info.currency;
    } else if (p.provider === 'openrouter') {
      const d = await json('/api/v1/credits'); const total = numeric(d.data?.total_credits); used = numeric(d.data?.total_usage); amount = total == null || used == null ? null : total - used; currency = 'USD';
    } else if (p.provider === 'moonshot') {
      const d = await json('/v1/users/me/balance'); amount = numeric(d.data?.available_balance);
      if (new URL(p.baseUrl).hostname === 'api.moonshot.cn') currency = 'CNY';
    } else {
      const c = p.custom, d = await json(c.path, c); kind = c.kind;
      const a = field(d, c.balanceField); amount = a == null ? null : a * c.scale;
      const u = c.usedField ? field(d, c.usedField) : null; used = u == null ? null : u * c.scale;
    }
    if (amount == null && !windows.length && !unlimited) throw new ProviderError('SHAPE', '没有找到有效金额，请检查接口和 JSON 字段');
    if (amount != null && !Number.isFinite(amount)) throw new ProviderError('SHAPE', '金额换算结果无效');
    return { amount, used, kind, currency, windows, unlimited, adapter: p.provider };
    } catch (e) { if (e instanceof ProviderError) e.details = { ...context, ...e.details }; throw e; }
  }
}
module.exports = { BalanceProvider, ProviderError, numeric, field, readBoundedJsonText };
