// @ts-check
/**
 * 本地诊断日志环（可观测）
 *
 * 设计约束：
 * - opt-in：默认关闭，关闭时 record 为 no-op，零开销。
 * - 仅内存环形缓冲（固定容量），Service Worker 重启即清空 —— 诊断数据短期、不落盘，
 *   避免敏感元数据持久化。
 * - 严格脱敏：record 的 meta 剔除 password/privateKey/mnemonic/token 等敏感键，
 *   字符串截断，非标量值忽略。record 绝不抛错（打点不得影响主逻辑）。
 */

import { getUserSetting, updateUserSetting } from '../storage/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';

const SETTING_KEY = 'diagnosticsEnabled';
const CAPACITY = 200;
const MAX_STRING_LEN = 200;

/** 敏感键（小写匹配），命中则从 meta 剔除，绝不进入诊断日志。 */
const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'privatekey',
  'encryptedprivatekey',
  'mnemonic',
  'encryptedmnemonic',
  'seed',
  'secret',
  'signature',
  'token',
  'ucantoken',
  'authtoken',
  'basicauth'
]);

/** @typedef {'info'|'warn'|'error'} DiagLevel */

/**
 * @typedef {Object} DiagEntry
 * @property {string} id
 * @property {number} time
 * @property {DiagLevel} level
 * @property {string} category
 * @property {string} action
 * @property {string} message
 * @property {Record<string, string|number|boolean|null>} meta
 */

function truncate(value) {
  const text = String(value);
  return text.length > MAX_STRING_LEN ? `${text.slice(0, MAX_STRING_LEN)}…` : text;
}

/**
 * 脱敏 meta：剔除敏感键，仅保留标量值（string 截断 / number / boolean / null）。
 * @param {any} meta
 * @returns {Record<string, string|number|boolean|null>}
 */
function sanitizeMeta(meta) {
  /** @type {Record<string, string|number|boolean|null>} */
  const out = {};
  if (!meta || typeof meta !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
      continue;
    }
    if (typeof value === 'string') {
      out[key] = truncate(value);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
    // 其它类型（对象/数组/函数）忽略，避免误带敏感嵌套数据。
  }
  return out;
}

class Diagnostics {
  constructor() {
    this._enabled = false;
    /** @type {DiagEntry[]} */
    this._buffer = [];
    this._seq = 0;
  }

  /** 从存储读取开关（background 启动时调用一次）。 */
  async init() {
    try {
      this._enabled = Boolean(await getUserSetting(SETTING_KEY, false));
    } catch (error) {
      this._enabled = false;
    }
  }

  isEnabled() {
    return this._enabled;
  }

  /**
   * @param {boolean} enabled
   */
  async setEnabled(enabled) {
    this._enabled = Boolean(enabled);
    try {
      await updateUserSetting(SETTING_KEY, this._enabled);
    } catch (error) {
      // 持久化失败不影响内存开关
    }
    if (!this._enabled) {
      this._buffer = [];
    }
    return this._enabled;
  }

  /**
   * 记录一条诊断事件。关闭时 no-op；绝不抛错。
   * @param {Object} entry
   * @param {DiagLevel} [entry.level]
   * @param {string} entry.category
   * @param {string} [entry.action]
   * @param {string} [entry.message]
   * @param {any} [entry.meta]
   */
  record({ level = 'info', category, action = '', message = '', meta } = /** @type {any} */ ({})) {
    if (!this._enabled) {
      return;
    }
    try {
      const normalizedLevel = level === 'error' || level === 'warn' ? level : 'info';
      this._seq += 1;
      /** @type {DiagEntry} */
      const item = {
        id: `diag_${getTimestamp()}_${this._seq}`,
        time: getTimestamp(),
        level: normalizedLevel,
        category: String(category || 'general'),
        action: truncate(action || ''),
        message: truncate(message || ''),
        meta: sanitizeMeta(meta)
      };
      this._buffer.push(item);
      if (this._buffer.length > CAPACITY) {
        this._buffer.splice(0, this._buffer.length - CAPACITY);
      }
    } catch (error) {
      // 打点失败必须静默，不能影响主流程
    }
  }

  /** @returns {DiagEntry[]} 最近在前 */
  getEntries() {
    return [...this._buffer].reverse();
  }

  clear() {
    this._buffer = [];
  }
}

export const diagnostics = new Diagnostics();
