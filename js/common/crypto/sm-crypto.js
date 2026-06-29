// @ts-check
/**
 * SM3 / SM4 / HMAC-SM3 薄包装
 *
 * 算法实现 vendored 自 sm-crypto@0.4.0（MIT，GitHub JuneAndGreen/sm-crypto），
 * 见 lib/sm-crypto/LICENSE 与 lib/sm-crypto/README.md。
 * 已知上游偏差（已在 lib/sm-crypto/sm3.js 修复）：
 *   - sm3.js 原循环变量名 shadow 外层 len，导致空输入时 bit-length 编码错误。
 *   - sm4.js S-box 索引 254、255 与国标相差 1 字节（不影响 round-trip）。
 *
 * 业务侧统一用 Uint8Array；vendored 实现的 array-of-number 不外露。
 */

import { sm3 as sm3Array, hmac as hmacArray } from '../../../lib/sm-crypto/sm3.js';
import { sm4Encrypt, sm4Decrypt } from '../../../lib/sm-crypto/sm4.js';

function arrayToUint8(arr) {
  return Uint8Array.from(arr);
}

function uint8ToArray(u8) {
  return Array.from(u8);
}

/**
 * SM3 哈希
 * @param {Uint8Array} data
 * @returns {Uint8Array} 32 字节
 */
export function sm3Hash(data) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('sm3Hash: data must be Uint8Array');
  }
  return arrayToUint8(sm3Array(uint8ToArray(data)));
}

/**
 * SM3 哈希 → 十六进制
 * @param {Uint8Array} data
 * @returns {string}
 */
export function sm3HashHex(data) {
  const h = sm3Hash(data);
  let s = '';
  for (let i = 0; i < h.length; i++) s += h[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * SM4-CBC 加密（PKCS#7 padding，IV 16 字节）
 * @param {Uint8Array} key 16 字节
 * @param {Uint8Array} iv 16 字节
 * @param {Uint8Array} data 任意长
 * @returns {Uint8Array} 密文（块对齐）
 */
export function sm4CbcEncrypt(key, iv, data) {
  if (!(key instanceof Uint8Array) || key.length !== 16) {
    throw new TypeError('sm4CbcEncrypt: key must be 16-byte Uint8Array');
  }
  if (!(iv instanceof Uint8Array) || iv.length !== 16) {
    throw new TypeError('sm4CbcEncrypt: iv must be 16-byte Uint8Array');
  }
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('sm4CbcEncrypt: data must be Uint8Array');
  }
  const out = sm4Encrypt(uint8ToArray(data), uint8ToArray(key), {
    mode: 'cbc',
    iv: uint8ToArray(iv),
    output: 'array',
    padding: 'pkcs#7'
  });
  return arrayToUint8(out);
}

/**
 * SM4-CBC 解密
 * @param {Uint8Array} key
 * @param {Uint8Array} iv
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array} 明文
 */
export function sm4CbcDecrypt(key, iv, ciphertext) {
  if (!(key instanceof Uint8Array) || key.length !== 16) {
    throw new TypeError('sm4CbcDecrypt: key must be 16-byte Uint8Array');
  }
  if (!(iv instanceof Uint8Array) || iv.length !== 16) {
    throw new TypeError('sm4CbcDecrypt: iv must be 16-byte Uint8Array');
  }
  if (!(ciphertext instanceof Uint8Array)) {
    throw new TypeError('sm4CbcDecrypt: ciphertext must be Uint8Array');
  }
  const out = sm4Decrypt(uint8ToArray(ciphertext), uint8ToArray(key), {
    mode: 'cbc',
    iv: uint8ToArray(iv),
    output: 'array',
    padding: 'pkcs#7'
  });
  return arrayToUint8(out);
}

/**
 * HMAC-SM3
 * @param {Uint8Array} key
 * @param {Uint8Array} msg
 * @returns {Uint8Array} 32 字节
 */
export function hmacSm3(key, msg) {
  if (!(key instanceof Uint8Array)) throw new TypeError('hmacSm3: key must be Uint8Array');
  if (!(msg instanceof Uint8Array)) throw new TypeError('hmacSm3: msg must be Uint8Array');
  return arrayToUint8(hmacArray(uint8ToArray(msg), uint8ToArray(key)));
}

/**
 * HMAC-SM3 → 十六进制
 * @param {Uint8Array} key
 * @param {Uint8Array} msg
 * @returns {string}
 */
export function hmacSm3Hex(key, msg) {
  const h = hmacSm3(key, msg);
  let s = '';
  for (let i = 0; i < h.length; i++) s += h[i].toString(16).padStart(2, '0');
  return s;
}
