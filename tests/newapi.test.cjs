'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { BalanceProvider } = require('../core/providers.cjs');
const { validateProfile } = require('../core/profiles.cjs');

const key = 'SYNTHETIC-NEWAPI-KEY';
const profile = extra => validateProfile({ name: 'New API', provider: 'newapi', baseUrl: 'https://example.invalid', key, ...extra });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const usage = extra => ({ object: 'token_usage', total_available: 500000, total_used: 250000, total_granted: 750000, unlimited_quota: false, ...extra });

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}

test('New API queries the canonical endpoint over real HTTP and accepts its boolean success envelope', async t => {
  const requests = [];
  const baseUrl = await serve(t, (req, res) => {
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    if (req.url === '/api/usage/token') {
      res.writeHead(301, { location: '/api/usage/token/' }); res.end(); return;
    }
    res.writeHead(req.url === '/api/usage/token/' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: true, message: 'ok', data: usage() }));
  });
  const result = await new BalanceProvider().query(profile({ baseUrl }), key);
  assert.deepEqual(requests, [{ path: '/api/usage/token/', method: 'GET', authorization: 'Bearer ' + key }]);
  assert.equal(result.kind, 'key-quota'); assert.equal(result.currency, 'USD');
  assert.equal(result.amount, 1); assert.equal(result.used, 0.5);
});

test('New API accepts existing success codes and converts total_* quota with the configured divisor', async () => {
  for (const code of [true, 0, 200, '0', '200', undefined]) {
    const result = await new BalanceProvider(async () => response({ code, data: usage() })).query(profile({ quotaPerUnit: 100000 }), key);
    assert.equal(result.amount, 5); assert.equal(result.used, 2.5);
  }
});

test('New API false/error codes and explicit failures remain failures even when quota is present', async () => {
  for (const envelope of [{ code: false }, { code: 'false' }, { code: 'KEY_EXPIRED' }, { code: true, success: false }, { code: true, ok: false }]) {
    await assert.rejects(new BalanceProvider(async () => response({ ...envelope, data: usage() })).query(profile(), key), error => error.code === 'API_ERROR');
  }
});

test('New API zero and unlimited quota stay distinct and used quota is still converted', async () => {
  const zero = await new BalanceProvider(async () => response({ code: true, data: usage({ total_available: 0, total_used: 0 }) })).query(profile(), key);
  assert.equal(zero.amount, 0); assert.equal(zero.used, 0); assert.equal(zero.unlimited, false);
  const unlimited = await new BalanceProvider(async () => response({ code: true, data: usage({ total_available: 0, unlimited_quota: true }) })).query(profile(), key);
  assert.equal(unlimited.amount, null); assert.equal(unlimited.used, 0.5); assert.equal(unlimited.unlimited, true);
});

test('legacy raw quota fields still convert and invalid amounts never become zero', async () => {
  const legacy = await new BalanceProvider(async () => response({ success: true, data: { remain_quota: '500000', used_quota: '250000' } })).query(profile(), key);
  assert.equal(legacy.amount, 1); assert.equal(legacy.used, 0.5);
  for (const total_available of [null, false, '', 'invalid']) {
    await assert.rejects(new BalanceProvider(async () => response({ code: true, data: usage({ total_available }) })).query(profile(), key), error => error.code === 'SHAPE');
  }
});

test('New API still rejects redirects without sending the key to their target', async t => {
  const requests = [];
  const baseUrl = await serve(t, (req, res) => {
    requests.push(req.url);
    res.writeHead(302, { location: '/redirect-target' }); res.end();
  });
  await assert.rejects(new BalanceProvider().query(profile({ baseUrl }), key), error => {
    assert.equal(error.code, 'NETWORK'); assert(!JSON.stringify(error.details).includes(key)); return true;
  });
  assert.deepEqual(requests, ['/api/usage/token/']);
});
