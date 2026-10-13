import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTranslations,
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

test('legacy static labels translate despite HTML indentation whitespace', async () => {
  resetI18nForTests();
  await setLocale('en-US');
  const label = {
    nodeType: 1,
    children: [],
    dataset: {},
    textContent: '\n  新建钱包\n',
    attrs: {},
    hasAttribute: () => false,
    matches: () => false,
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelectorAll: () => []
  };
  const body = {
    querySelectorAll(selector) { return selector.startsWith('body ') ? [label] : []; },
    querySelector: () => null
  };
  const root = {
    body,
    documentElement: { lang: 'zh-CN' },
    querySelectorAll(selector) {
      if (selector === 'body *:not(script):not(style)') return [label];
      return [];
    },
    querySelector: () => body
  };
  applyTranslations(root);
  assert.equal(label.textContent, 'Create wallet');
  await setLocale('zh-CN');
  applyTranslations(root);
  assert.equal(label.textContent, '\n  新建钱包\n');
});
