import { LOCAL_KEYS } from '../../config/storage-keys.js';
import { messagesZhCN } from './messages-zh-CN.js';
import { messagesEnUS } from './messages-en-US.js';
import { legacyEnglishText } from './legacy-text.js';

export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en-US']);
const FALLBACK_LOCALE = 'en-US';
const catalogs = Object.freeze({ 'zh-CN': messagesZhCN, 'en-US': messagesEnUS });
let activeLocale = FALLBACK_LOCALE;
let initialized = false;
let translationObserver = null;
let storageListenerRegistered = false;

function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return null;
}

export function getDefaultLocale(browserLanguage = globalThis.navigator?.language) {
  return normalizeLocale(browserLanguage) || FALLBACK_LOCALE;
}

export function getLocale() {
  return activeLocale;
}

export function t(key, params = {}) {
  const catalog = catalogs[activeLocale] || catalogs[FALLBACK_LOCALE];
  const fallback = catalogs[FALLBACK_LOCALE];
  const template = catalog[key] ?? fallback[key] ?? key;
  return String(template).replace(/\{([\w.-]+)\}/g, (_match, name) => {
    const value = params?.[name];
    return value === undefined || value === null ? `{${name}}` : String(value);
  });
}

export function applyTranslations(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const select = (selector) => {
    const found = Array.from(root.querySelectorAll(selector));
    if (root.matches?.(selector)) found.unshift(root);
    return found;
  };
  select('[data-i18n]').forEach((element) => {
    const translated = t(element.dataset.i18n);
    if (element.textContent !== translated) element.textContent = translated;
  });
  select('[data-i18n-placeholder]').forEach((element) => {
    const translated = t(element.dataset.i18nPlaceholder);
    if (element.getAttribute('placeholder') !== translated) element.setAttribute('placeholder', translated);
  });
  select('[data-i18n-title]').forEach((element) => {
    const translated = t(element.dataset.i18nTitle);
    if (element.getAttribute('title') !== translated) element.setAttribute('title', translated);
  });
  select('[data-i18n-aria-label]').forEach((element) => {
    const translated = t(element.dataset.i18nAriaLabel);
    if (element.getAttribute('aria-label') !== translated) element.setAttribute('aria-label', translated);
  });
  if (root.body || root.querySelector('body') || root.nodeType === 1) {
    const legacyNodes = root.nodeType === 1
      ? [root, ...Array.from(root.querySelectorAll('*:not(script):not(style)'))]
      : select('body *:not(script):not(style)');
    legacyNodes.forEach((element) => {
      if (element.children.length > 0) return;
      if (element.hasAttribute?.('data-i18n')) return;
      if (element.matches?.('input, textarea, select, option, [data-user-content]')) return;
      const currentText = element.textContent ?? '';
      let source = element.dataset.i18nLegacySource;
      const previousText = element.dataset.i18nLegacyLastText;
      if (!source || (currentText !== previousText && currentText !== source)) {
        source = currentText;
        element.dataset.i18nLegacySource = source;
      }
      const translated = source.trim() ? legacyEnglishText[source.trim()] : null;
      if (activeLocale === 'en-US' && translated) {
        if (element.textContent !== translated) element.textContent = translated;
        element.dataset.i18nLegacyLastText = translated;
      } else if (activeLocale !== 'en-US' && previousText && currentText === previousText) {
        if (element.textContent !== source) element.textContent = source;
        element.dataset.i18nLegacyLastText = source;
      } else {
        element.dataset.i18nLegacyLastText = currentText;
      }
      for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
        const value = element.getAttribute?.(attribute);
        const sourceDataKey = `i18nLegacy${attribute[0].toUpperCase()}${attribute.slice(1)}`;
        const lastDataKey = `${sourceDataKey}Last`;
        let sourceValue = element.dataset[sourceDataKey];
        const previousValue = element.dataset[lastDataKey];
        if (value && (!sourceValue || (value !== previousValue && value !== sourceValue))) {
          sourceValue = value;
          element.dataset[sourceDataKey] = sourceValue;
        }
        const translatedValue = sourceValue ? legacyEnglishText[sourceValue] : null;
        if (activeLocale === 'en-US' && translatedValue) {
          if (value !== translatedValue) element.setAttribute(attribute, translatedValue);
          element.dataset[lastDataKey] = translatedValue;
        } else if (activeLocale !== 'en-US' && previousValue && value === previousValue && sourceValue) {
          if (value !== sourceValue) element.setAttribute(attribute, sourceValue);
          element.dataset[lastDataKey] = sourceValue;
        }
      }
    });
  }
  if (root.documentElement) root.documentElement.lang = activeLocale;
}

export async function initI18n() {
  if (initialized) return activeLocale;
  const stored = await chrome.storage.local.get(LOCAL_KEYS.LANGUAGE).catch(() => ({}));
  activeLocale = normalizeLocale(stored?.[LOCAL_KEYS.LANGUAGE]) || getDefaultLocale();
  initialized = true;
  applyTranslations();
  if (!storageListenerRegistered && chrome.storage.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName && areaName !== 'local') return;
      const language = normalizeLocale(changes?.[LOCAL_KEYS.LANGUAGE]?.newValue);
      if (!language || language === activeLocale) return;
      activeLocale = language;
      applyTranslations();
    });
    storageListenerRegistered = true;
  }
  if (!translationObserver && globalThis.MutationObserver && globalThis.document?.body) {
    translationObserver = new globalThis.MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes?.forEach((node) => {
          if (node.nodeType === 1) applyTranslations(node);
        });
        if (record.type === 'attributes' && record.target?.nodeType === 1) applyTranslations(record.target);
      });
    });
    translationObserver.observe(globalThis.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder', 'alt']
    });
  }
  return activeLocale;
}

export async function setLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (!normalized) throw new Error(`Unsupported locale: ${locale}`);
  activeLocale = normalized;
  initialized = true;
  await chrome.storage.local.set({ [LOCAL_KEYS.LANGUAGE]: normalized });
  applyTranslations();
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new globalThis.CustomEvent('wallet-language-changed', { detail: { locale: normalized } }));
  }
  return normalized;
}

export function resetI18nForTests() {
  translationObserver?.disconnect?.();
  translationObserver = null;
  activeLocale = FALLBACK_LOCALE;
  initialized = false;
}
