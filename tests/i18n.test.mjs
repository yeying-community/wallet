import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultLocale,
  getLocale,
  resetI18nForTests,
  setLocale,
  t
} from '../js/common/i18n/index.js';

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, store.get(item)]));
        return { [key]: store.get(key) };
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => store.set(key, value));
      }
    }
  }
};

test('browser locale resolves deterministically', () => {
  assert.equal(getDefaultLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(getDefaultLocale('en-GB'), 'en-US');
  assert.equal(getDefaultLocale('ja-JP'), 'en-US');
});

test('translations interpolate parameters and fall back to keys', async () => {
  resetI18nForTests();
  await setLocale('en-US');
  assert.equal(getLocale(), 'en-US');
  assert.equal(t('error.initialization', { message: 'boom' }), 'Initialization failed: boom');
  assert.equal(t('missing.key'), 'missing.key');
  await setLocale('zh-CN');
  assert.equal(t('welcome.create'), '新建钱包');
  assert.equal(store.get('language'), 'zh-CN');
});
