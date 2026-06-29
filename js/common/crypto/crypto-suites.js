// @ts-check
/**
 * 命名安全套件注册表
 *
 * 暴露面（业务侧只该用这三个）：
 *   - getSupportedSuites()    — 列出可用套件（name + description + mode）
 *   - encryptData({data, password, suite?})  → 密文（base64 字符串，固定 v1 格式）
 *   - decryptData({ciphertext, password})   → 明文（Uint8Array 形式）
 *
 * 不暴露：算法/IV/迭代次数等裸参数（全部锁死常量）。
 */

import {
  generateRandomBytes,
  base64Encode,
  base64Decode,
  stringToBytes,
  normalizeBinaryInput
} from './crypto-utils.js';
import { SUITE_DEFINITIONS, DEFAULT_SUITE } from './crypto-constants.js';
import { sm3Hash, sm4CbcEncrypt, sm4CbcDecrypt, hmacSm3 } from './sm-crypto.js';
import { createCryptoError } from '../errors/index.js';

const CIPHERTEXT_VERSION = 'v1';
const HMAC_KEY_OFFSET = 0;
const ENCRYPT_KEY_OFFSET = 16;

/**
 * WebCrypto 期望 BufferSource（含 ArrayBufferView<ArrayBuffer>）。Node 22 + TS 5
 * 把 Uint8Array 推为 Uint8Array<ArrayBufferLike>，与 BufferSource 不直接兼容。
 * 显式转换：取底层 ArrayBuffer 视图，避免类型告警。
 * @param {Uint8Array} u8
 * @returns {BufferSource}
 */
function bs(u8) {
  // .buffer 在 Node 永远是非 SharedArrayBuffer 的 ArrayBuffer
  return /** @type {BufferSource} */ (u8);
}

/**
 * 列出可用套件（业务侧 UI/CLI 用）
 * @returns {Array<{name: string, description: string, mode: string}>}
 */
export function getSupportedSuites() {
  return Object.values(SUITE_DEFINITIONS).map((s) => ({
    name: s.name,
    description: s.description,
    mode: s.mode
  }));
}

/** 抛错：套件名不识别 */
function unsupportedSuite(name) {
  return createCryptoError(`Unsupported suite: ${name}`);
}

/** 抛错：密文格式坏 */
function invalidCiphertext(reason) {
  return createCryptoError(`Invalid ciphertext: ${reason}`);
}

/**
 * 派生 AES-256 key + iv 用
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @param {number} keyLengthBits
 * @param {string} hash
 * @returns {Promise<CryptoKey>}
 */
async function deriveAesKey(password, salt, iterations, keyLengthBits, hash) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    bs(stringToBytes(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations, hash },
    baseKey,
    { name: 'AES-GCM', length: keyLengthBits },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * PBKDF2 派生 32 字节原始字节（用于 SM4 路径：前 16 加密 + 后 16 HMAC）
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<Uint8Array>}
 */
async function deriveRaw32(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    bs(stringToBytes(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bs(salt), iterations, hash: 'SHA-256' },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

/**
 * 加密 → v1 格式密文 base64 字符串
 * @param {Object} args
 * @param {string|Uint8Array|ArrayBuffer|ArrayBufferView|number[]} args.data
 * @param {string} args.password
 * @param {string} [args.suite] 默认 'aes-256-gcm'
 * @returns {Promise<string>}
 */
export async function encryptData({ data, password, suite }) {
  if (typeof password !== 'string' || password.length === 0) {
    throw createCryptoError('Password is required');
  }
  const normalizedData = normalizeBinaryInput(data);
  if (normalizedData == null) {
    throw createCryptoError('Data must be string or binary');
  }
  const suiteName = suite || DEFAULT_SUITE;
  const def = SUITE_DEFINITIONS[suiteName];
  if (!def) throw unsupportedSuite(suiteName);

  if (def.mode === 'hash') {
    // 哈希套件：直接返回 hash
    const input = typeof normalizedData === 'string' ? stringToBytes(normalizedData) : normalizedData;
    const h = suiteName === 'sm3' ? sm3Hash(input) : new Uint8Array(await crypto.subtle.digest('SHA-256', bs(input)));
    return `${CIPHERTEXT_VERSION}:${suiteName}:${base64Encode(h)}`;
  }

  // 对称加密套件
  const input = typeof normalizedData === 'string' ? stringToBytes(normalizedData) : normalizedData;
  const salt = generateRandomBytes(def.pbkdf2.saltLength);
  const iv = generateRandomBytes(def.ivLength);

  if (suiteName === 'aes-256-gcm') {
    const aesKey = await deriveAesKey(password, salt, def.pbkdf2.iterations, def.keyLength, def.pbkdf2.hash);
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bs(iv), tagLength: 128 },
      aesKey,
      bs(input)
    ));
    return `${CIPHERTEXT_VERSION}:${suiteName}:${base64Encode(salt)}:${base64Encode(iv)}:${base64Encode(ct)}`;
  }

  if (suiteName === 'sm4-cbc-hmac-sm3') {
    const raw = await deriveRaw32(password, salt, def.pbkdf2.iterations);
    const encKey = raw.subarray(ENCRYPT_KEY_OFFSET, ENCRYPT_KEY_OFFSET + 16);
    const macKey = raw.subarray(HMAC_KEY_OFFSET, HMAC_KEY_OFFSET + 16);
    const ct = sm4CbcEncrypt(encKey, iv, input);
    // encrypt-then-MAC：先算密文，再算密文+iv 的 mac
    const macInput = new Uint8Array(iv.length + ct.length);
    macInput.set(iv, 0);
    macInput.set(ct, iv.length);
    const mac = hmacSm3(macKey, macInput);
    return `${CIPHERTEXT_VERSION}:${suiteName}:${base64Encode(salt)}:${base64Encode(iv)}:${base64Encode(ct)}:${base64Encode(mac)}`;
  }

  throw unsupportedSuite(suiteName);
}

/**
 * 解密
 * @param {Object} args
 * @param {string} args.ciphertext v1 格式密文
 * @param {string} args.password
 * @returns {Promise<Uint8Array>} 明文
 */
export async function decryptData({ ciphertext, password }) {
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw invalidCiphertext('empty');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw createCryptoError('Password is required');
  }
  const parts = ciphertext.split(':');
  if (parts.length < 2) throw invalidCiphertext('missing fields');
  const [version, suiteName] = parts;
  if (version !== CIPHERTEXT_VERSION) throw invalidCiphertext(`unknown version ${version}`);
  const def = SUITE_DEFINITIONS[suiteName];
  if (!def) throw unsupportedSuite(suiteName);

  if (def.mode === 'hash') {
    // 哈希套件没有"解密"语义
    throw createCryptoError(`Suite ${suiteName} is a hash, cannot decrypt`);
  }

  if (parts.length < 5) throw invalidCiphertext('missing fields');

  const salt = base64Decode(parts[2]);
  const iv = base64Decode(parts[3]);
  const ct = base64Decode(parts[4]);

  if (suiteName === 'aes-256-gcm') {
    const aesKey = await deriveAesKey(password, salt, def.pbkdf2.iterations, def.keyLength, def.pbkdf2.hash);
    try {
      const pt = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bs(iv), tagLength: 128 },
        aesKey,
        bs(ct)
      ));
      return pt;
    } catch {
      throw invalidCiphertext('decryption failed (wrong password or tampered)');
    }
  }

  if (suiteName === 'sm4-cbc-hmac-sm3') {
    if (parts.length < 6) throw invalidCiphertext('missing mac');
    const mac = base64Decode(parts[5]);
    const raw = await deriveRaw32(password, salt, def.pbkdf2.iterations);
    const encKey = raw.subarray(ENCRYPT_KEY_OFFSET, ENCRYPT_KEY_OFFSET + 16);
    const macKey = raw.subarray(HMAC_KEY_OFFSET, HMAC_KEY_OFFSET + 16);
    // 先验 mac（防 padding oracle / 防密文篡改）
    const macInput = new Uint8Array(iv.length + ct.length);
    macInput.set(iv, 0);
    macInput.set(ct, iv.length);
    const expectedMac = hmacSm3(macKey, macInput);
    if (!timingSafeEqual(mac, expectedMac)) {
      throw invalidCiphertext('mac mismatch (wrong password or tampered)');
    }
    return sm4CbcDecrypt(encKey, iv, ct);
  }

  throw unsupportedSuite(suiteName);
}

/**
 * 常量时间比较（防侧信道）
 */
function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 导出 tools（用于内部单测 / 调试）
export { CIPHERTEXT_VERSION, timingSafeEqual };
