'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { convert, result } = require('../ui/money.js');
const { validateProfile } = require('../core/profiles.cjs');
const input = { name: 'A', provider: 'sub2api', baseUrl: 'https://a.example', key: 'TEST-KEY' };
test('per-site multipliers convert amounts into the chosen currency without mutating source records', () => {
  const a = { moneyConversion: { enabled: true, rate: .2, currency: 'CNY' } }, b = { moneyConversion: { enabled: true, rate: 2, currency: 'USD' } };
  const raw = { amount: 10, used: 2, currency: 'USD', kind: 'wallet', windows: [{ label: '1d', used: 2, limit: 20 }] }, copy = structuredClone(raw);
  assert.deepEqual(convert(10, 'USD', a), { amount: 2, currency: 'CNY', converted: true });
  assert.equal(result(raw, a).windows[0].limit, 4); assert.equal(result(raw, b).amount, 20);
  assert.deepEqual(raw, copy); assert.equal(convert(0, 'USD', a).amount, 0);
  assert.equal(convert(null, 'USD', a).amount, null); assert.equal(convert(undefined, 'USD', a).amount, null);
  assert.equal(convert(Number.MAX_VALUE, 'USD', b).amount, null);
});
test('disabled conversion preserves legacy currencies and partial saved-profile edits preserve conversion', () => {
  const original = validateProfile({ ...input, moneyConversion: { enabled: true, rate: .01, currency: 'USD' } });
  const saved = { ...original, keyCipher: 'encrypted' }; delete saved.key;
  assert.deepEqual(validateProfile({ ...input, key: '', name: 'Renamed' }, saved).moneyConversion, original.moneyConversion);
  const legacy = validateProfile(input); assert.equal(legacy.moneyConversion.enabled, false);
  assert.deepEqual(convert(10, 'HKD', legacy), { amount: 10, currency: 'HKD', converted: false });
});
test('invalid conversion ratios and currency labels are rejected before saving', () => {
  for (const rate of [0, -1, Infinity, NaN, '', ' ', 1e10]) assert.throws(() => validateProfile({ ...input, moneyConversion: { enabled: true, rate, currency: 'USD' } }), /转换比例/);
  for (const currency of ['EUR', '', 'usd']) assert.throws(() => validateProfile({ ...input, moneyConversion: { enabled: true, rate: 1, currency } }), /显示币种/);
  assert.throws(() => validateProfile({ ...input, moneyConversion: { enabled: 'true', rate: 1, currency: 'USD' } }), /开关/);
});
test('sandboxed browser and main process use identical conversion math for tiny deductions', () => {
  const sandbox = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../ui/money.js'), 'utf8'), sandbox);
  const p = { moneyConversion: { enabled: true, rate: .04, currency: 'CNY' } };
  for (const amount of [0, .00000001, .12345678, 10, null]) assert.equal(sandbox.MoneyConversion.convert(amount, 'USD', p).amount, convert(amount, 'USD', p).amount);
});
