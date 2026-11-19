import { LOCAL_KEYS } from '../../config/storage-keys.js';
import { messagesZhCN } from './messages-zh-CN.js';
import { messagesEnUS } from './messages-en-US.js';
import { legacyEnglishText } from './legacy-text.js';
import { extraEnglishText, englishPatterns } from './legacy-text-extra.js';

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

function legacyAttributeDatasetKey(attribute) {
  const camelAttribute = attribute.replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
  return `i18nLegacy${camelAttribute[0].toUpperCase()}${camelAttribute.slice(1)}`;
}

// ---- 中文界面文字 → 英文 ------------------------------------------------------------------
// 词典来源(优先级从高到低):legacy-text.js(人工维护)、语言包里中文值对应的英文、legacy-text-extra.js
// (整体抽取翻译)。带 {0} 的模式匹配运行时拼出的句子,捕获到的值如果也在词典里,同样翻译。
const HAN = /[\u4e00-\u9fff]/;
let staticMap = null;
let patternList = null;
function buildMaps() {
  if (staticMap) return;
  staticMap = new Map();
  for (const [zh, en] of Object.entries(extraEnglishText)) staticMap.set(zh, en);
  for (const [key, zh] of Object.entries(messagesZhCN)) {
    const en = messagesEnUS[key];
    if (typeof zh === 'string' && en && HAN.test(zh) && !/\{[\w.-]+\}/.test(zh)) staticMap.set(zh, en);
  }
  for (const [zh, en] of Object.entries(legacyEnglishText)) staticMap.set(zh, en);
  patternList = Object.entries(englishPatterns).map(([zh, en]) => {
    const parts = zh.split(/(\{\d+\})/);
    const order = [];
    const re = parts.map((part) => {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { re: new RegExp('^' + re + '$'), order, en, literal: zh.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.literal - a.literal); // 字面部分越长越具体,先试
}

/** 把一段中文界面文字翻成英文;没有对应译文时返回 null。 */
export function translateLegacyText(text, depth = 0) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || !HAN.test(trimmed)) return null;
  buildMaps();
  const hit = staticMap.get(trimmed);
  if (hit) return hit;
  if (depth > 8) return null;
  for (const p of patternList) {
    const m = p.re.exec(trimmed);
    if (!m) continue;
    const values = {};
    p.order.forEach((index, i) => {
      const raw = m[i + 1];
      values[index] = translateLegacyText(raw, depth + 1) ?? raw;
    });
    return p.en.replace(/\{(\d+)\}/g, (_x, n) => values[n] ?? '');
  }
  return null;
}

/** 当前界面语言下应显示的文字:英文界面翻译,中文界面原样。 */
export function localizeText(text) {
  if (activeLocale !== 'en-US') return text;
  return translateLegacyText(text) ?? text;
}

const textNodeState = new WeakMap();
function translateTextNode(node) {
  const current = node.textContent ?? '';
  let state = textNodeState.get(node);
  if (!state || (current !== state.last && current !== state.source)) {
    state = { source: current, last: current };
    textNodeState.set(node, state);
  }
  const lead = state.source.match(/^\s*/)[0];
  const tail = state.source.match(/\s*$/)[0];
  const translated = activeLocale === 'en-US' ? translateLegacyText(state.source) : null;
  const next = translated ? lead + translated + tail : state.source;
  if (activeLocale === 'en-US' && !translated) { state.last = current; return; }
  if (current !== next) node.textContent = next;
  state.last = next;
}

// 原生弹框(confirm / alert / prompt)里的文字也按界面语言显示
function patchNativeDialogs() {
  const w = globalThis.window;
  if (!w || w.__walletI18nDialogs) return;
  w.__walletI18nDialogs = true;
  for (const name of ['confirm', 'alert', 'prompt']) {
    const original = w[name];
    if (typeof original !== 'function') continue;
    w[name] = function (message, ...rest) {
      return original.call(w, typeof message === 'string' ? localizeText(message) : message, ...rest);
    };
  }
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
      if (element.closest?.('[data-user-content], [data-no-i18n]')) return;
      // 属性(title / aria-label / placeholder / alt):所有元素都处理,包括带图标子节点的按钮与输入框
      for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
        const value = element.getAttribute?.(attribute);
        const sourceDataKey = legacyAttributeDatasetKey(attribute);
        const lastDataKey = `${sourceDataKey}Last`;
        let sourceValue = element.dataset[sourceDataKey];
        const previousValue = element.dataset[lastDataKey];
        if (value && (!sourceValue || (value !== previousValue && value !== sourceValue))) {
          sourceValue = value;
          element.dataset[sourceDataKey] = sourceValue;
        }
        const translatedValue = sourceValue ? translateLegacyText(sourceValue) : null;
        if (activeLocale === 'en-US' && translatedValue) {
          if (value !== translatedValue) element.setAttribute(attribute, translatedValue);
          element.dataset[lastDataKey] = translatedValue;
        } else if (activeLocale !== 'en-US' && previousValue && value === previousValue && sourceValue) {
          if (value !== sourceValue) element.setAttribute(attribute, sourceValue);
          element.dataset[lastDataKey] = sourceValue;
        }
      }
      if (element.hasAttribute?.('data-i18n')) return;
      if (element.matches?.('input, textarea, select')) return;
      if (element.children.length > 0) {
        // 文字与子元素混排(例如 "说明文字 <a>链接</a>"):逐个翻译直接子文本节点
        element.childNodes?.forEach?.((node) => { if (node.nodeType === 3) translateTextNode(node); });
        return;
      }
      const currentText = element.textContent ?? '';
      let source = element.dataset.i18nLegacySource;
      const previousText = element.dataset.i18nLegacyLastText;
      if (!source || (currentText !== previousText && currentText !== source)) {
        source = currentText;
        element.dataset.i18nLegacySource = source;
      }
      const translated = source.trim() ? translateLegacyText(source.trim()) : null;
      if (activeLocale === 'en-US' && translated) {
        if (element.textContent !== translated) element.textContent = translated;
        element.dataset.i18nLegacyLastText = translated;
      } else if (activeLocale !== 'en-US' && previousText && currentText === previousText) {
        if (element.textContent !== source) element.textContent = source;
        element.dataset.i18nLegacyLastText = source;
      } else {
        element.dataset.i18nLegacyLastText = currentText;
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
  patchNativeDialogs();
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
      const targets = new Set();
      records.forEach((record) => {
        record.addedNodes?.forEach((node) => {
          if (node.nodeType === 1) targets.add(node);
          // el.textContent = '...' 换掉的是文本节点:翻译它所在的元素
          else if (node.nodeType === 3 && node.parentElement) targets.add(node.parentElement);
        });
        if (record.type === 'attributes' && record.target?.nodeType === 1) targets.add(record.target);
        if (record.type === 'characterData' && record.target?.parentElement) targets.add(record.target.parentElement);
      });
      targets.forEach((target) => { if (target.isConnected !== false) applyTranslations(target); });
    });
    translationObserver.observe(globalThis.document.body, {
      childList: true,
      subtree: true,
      characterData: true,
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
