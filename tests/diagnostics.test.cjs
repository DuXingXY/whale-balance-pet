'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BalanceProvider } = require('../core/providers.cjs');
const profile = { provider: 'sub2api', baseUrl: 'https://example.invalid', currency: 'USD' };
test('HTTP diagnostics preserve status and service code without exposing echoed credentials or account fields', async () => {
  const key = 'PRIVATE-TEST-' + 'X'.repeat(5000);
  const provider = new BalanceProvider(async () => new Response(JSON.stringify({ error: { code: 'API_KEY_INVALID', message: 'Authorization Bearer ' + key }, account: { email: 'private@example.invalid' }, key }), { status: 401, headers: { 'content-type': 'application/json', 'x-request-id': 'req-demo-01' } }));
  await assert.rejects(provider.query(profile, key), e => {
    assert.equal(e.code, 'HTTP_401'); assert.equal(e.details.http_status, 401); assert.equal(e.details.server_code, 'API_KEY_INVALID'); assert.equal(e.details.request_id, 'req-demo-01');
    assert.equal(e.details.endpoint, 'https://example.invalid/v1/usage');
    const serialized = JSON.stringify(e.details); assert(!serialized.includes('PRIVATE-TEST-')); assert(!serialized.includes('XXXX')); assert(!serialized.includes('private@example')); assert(serialized.includes('已隐藏')); return true;
  });
});
test('API rejection, invalid JSON, schema failure and network cause have structured diagnoses', async () => {
  for (const [body, code] of [['{"success":false,"code":"KEY_EXPIRED","message":"expired"}', 'API_ERROR'], ['broken JSON', 'SHAPE'], ['{"mode":"unrestricted"}', 'SHAPE']]) {
    await assert.rejects(new BalanceProvider(async () => new Response(body, { headers: { 'content-type': 'application/json' } })).query(profile, 'TEST'), e => { assert.equal(e.code, code); assert.equal(e.details.adapter, 'sub2api'); assert.equal(e.details.endpoint, 'https://example.invalid/v1/usage'); return true; });
  }
  await assert.rejects(new BalanceProvider(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', name: 'Error' } }); }).query(profile, 'TEST'), e => { assert.equal(e.code, 'NETWORK'); assert.equal(e.details.network_error, 'ENOTFOUND'); return true; });
});
