// @ts-check
/**
 * 最小 DOM stub —— 给 UI 控制器单测使用。
 *
 * 仅实现 controller 实际用到的 API：getElementById、querySelector、addEventListener、
 * dispatchEvent、classList、dataset、closest、innerHTML、textContent、value、disabled、
 * focus。够 settings/sites/account UI 路径验证，不做通用 jsdom 替代品。
 *
 * 不依赖第三方；运行时仍零 npm 依赖。
 */

/**
 * @typedef {Object} DomElement
 * @property {string} id
 * @property {string} tagName
 * @property {Record<string, string>} [dataset]
 * @property {Record<string, any>} [attrs]
 * @property {DomElement[]} children
 * @property {DomElement|null} parent
 * @property {string} [innerHTML]
 * @property {string} [textContent]
 * @property {string} [value]
 * @property {boolean} [disabled]
 * @property {boolean} [checked]
 * @property {Record<string, Function[]>} listeners
 * @property {{add: Function, remove: Function, contains: Function, toggle: Function}} classList
 * @property {Function} [focus]
 * @property {Function} [click]
 * @property {(selector: string) => DomElement|null} querySelector
 * @property {(selector: string) => DomElement[]} querySelectorAll
 * @property {(selector: string) => DomElement|null} closest
 * @property {(event: any) => boolean} dispatchEvent
 * @property {(type: string, listener: Function) => void} addEventListener
 * @property {(type: string, listener: Function) => void} removeEventListener
 * @property {(name: string) => string|null} getAttribute
 * @property {(name: string, value: string) => void} setAttribute
 * @property {(name: string) => boolean} hasAttribute
 */

function makeClassList(el) {
  const set = new Set((el._classes || '').split(/\s+/).filter(Boolean));
  const cl = {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, force) => {
      const want = typeof force === 'boolean' ? force : !set.has(name);
      if (want) set.add(name); else set.delete(name);
      return want;
    },
    contains: (name) => set.has(name),
    _set: set
  };
  Object.defineProperty(el, 'classList', { value: cl, configurable: true });
  return cl;
}

function parseSelector(selector) {
  // 支持 #id、.class、tag（简单三选一，够 sites-controller 用）
  if (selector.startsWith('#')) return { type: 'id', value: selector.slice(1) };
  if (selector.startsWith('.')) return { type: 'class', value: selector.slice(1) };
  return { type: 'tag', value: selector };
}

function matches(el, sel) {
  const p = parseSelector(sel);
  if (p.type === 'id') return el.id === p.value;
  if (p.type === 'class') return (el.classList._set || new Set()).has(p.value);
  return el.tagName === p.value.toUpperCase();
}

function findIn(el, selector) {
  if (matches(el, selector)) return el;
  for (const c of el.children) {
    const found = findIn(c, selector);
    if (found) return found;
  }
  return null;
}

function findAllIn(el, selector, out = []) {
  if (matches(el, selector)) out.push(el);
  for (const c of el.children) findAllIn(c, selector, out);
  return out;
}

/**
 * @param {Partial<DomElement>} init
 * @returns {DomElement}
 */
export function createElement(init = {}) {
  const el = {
    id: init.id || '',
    tagName: (init.tagName || 'div').toUpperCase(),
    dataset: init.dataset || {},
    attrs: init.attrs || {},
    children: init.children || [],
    parent: init.parent || null,
    listeners: {},
    disabled: !!init.disabled,
    ...init
  };
  el.children.forEach((c) => { c.parent = el; });
  makeClassList(el);
  el._setAttribute = (name, value) => { el.attrs[name] = value; };
  el.querySelector = (selector) => {
    if (selector === '.modal-overlay') {
      // 特殊处理：取子节点第一个 class 含 modal-overlay 的 div
      for (const c of el.children) {
        if ((c.classList._set || new Set()).has('modal-overlay')) return c;
      }
      return null;
    }
    return findIn(el, selector);
  };
  el.querySelectorAll = (selector) => findAllIn(el, selector);
  el.closest = (selector) => {
    let cur = el;
    while (cur) {
      if (matches(cur, selector)) return cur;
      cur = cur.parent;
    }
    return null;
  };
  el.dispatchEvent = (event) => {
    let node = el;
    const path = [];
    while (node) { path.push(node); node = node.parent; }
    const target = path[0];
    for (const current of path) {
      const list = current.listeners?.[event.type] || [];
      for (const fn of [...list]) {
        const e = {
          ...event,
          target,
          currentTarget: current,
          defaultPrevented: false,
          propagationStopped: false,
          preventDefault() { e.defaultPrevented = true; },
          stopPropagation() { e.propagationStopped = true; }
        };
        fn.call(current, e);
        if (e.propagationStopped) return !e.defaultPrevented;
      }
    }
    return !event.defaultPrevented;
  };
  el.addEventListener = (type, fn) => {
    (el.listeners[type] ||= []).push(fn);
  };
  el.removeEventListener = (type, fn) => {
    if (el.listeners[type]) el.listeners[type] = el.listeners[type].filter((f) => f !== fn);
  };
  el.getAttribute = (name) => el.attrs[name] ?? null;
  el.setAttribute = (name, value) => { el.attrs[name] = String(value); };
  el.hasAttribute = (name) => name in el.attrs;
  el.focus = () => {};
  el.click = () => el.dispatchEvent({ type: 'click' });
  return el;
}

/**
 * 创建一组按 id 索引的 stub element 字典，挂到 document.getElementById。
 * 自动追加 `.page` 选择器可见性 + globalWaitingOverlay 自动创建等共性。
 * @param {Record<string, Partial<DomElement>>} idMap  id → element init
 * @returns {{ document: any, elements: Record<string, DomElement> }}
 */
export function createDocument(idMap = {}) {
  /** @type {Record<string, DomElement>} */
  const elements = {};
  /** @type {DomElement[]} */
  const allElements = [];
  for (const [id, init] of Object.entries(idMap)) {
    elements[id] = createElement({ id, ...init });
    allElements.push(elements[id]);
  }

  // 自动添加 ui/index.js 期望的几个全局节点（如果调用方没显式提供）
  if (!elements.globalToast) {
    elements.globalToast = createElement({ id: 'globalToast' });
    allElements.push(elements.globalToast);
  }
  if (!elements.globalWaitingOverlay) {
    elements.globalWaitingOverlay = createElement({ id: 'globalWaitingOverlay' });
    allElements.push(elements.globalWaitingOverlay);
  }

  const document = {
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      for (const el of allElements) {
        const f = findIn(el, sel);
        if (f) return f;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      const out = [];
      for (const el of allElements) findAllIn(el, sel, out);
      return out;
    },
    createElement: (tagName) => createElement({ tagName }),
    body: createElement({ tagName: 'body' }),
    get elements() { return elements; }
  };
  return { document, elements };
}