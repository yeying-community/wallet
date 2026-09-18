// @ts-check
/**
 * Vendored Base58Check (无 npm 运行时依赖)
 *
 * 算法来源：Bitcoin Base58Check + SHA-256 double-hash checksum（与 Tron 一致）。
 * - 编码：payload（21 字节：1 字节 version + 20 字节 hash）→ sha256(sha256(payload)) 取前 4 字节
 *   → 拼成 25 字节 → Base58 → 字符串
 * - 校验：Base58 解码 → 25 字节 → 拆分 payload / checksum → sha256(sha256(payload)) 前 4 字节
 *   与校验和比对
 *
 * Base58 字母表：123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz（无 0/O/I/l）
 *
 * 仅依赖：`lib/ethers-6.16.esm.min.js` 提供 `ethers.sha256`（已 vendored，浏览器侧可用）。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = (() => {
  const map = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE58_ALPHABET.length; i += 1) {
    map[BASE58_ALPHABET.charCodeAt(i)] = i;
  }
  return map;
})();

function bytesToHex(bytes) {
  let out = '0x';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex) {
  const s = String(hex || '').trim();
  const raw = s.startsWith('0x') ? s.slice(2) : s;
  if (raw.length % 2 !== 0) throw new Error('hex string length must be even');
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * 把任意字节串编码成 Base58 字符串（无 checksum）。
 *
 * 算法（Bitcoin Base58）：把字节串视作大端整数，转 base-58 数位；
 * 前导 0 字节独立编码为前导 '1'（'1' 在 Base58 中代表 0）。
 */
export function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('base58Encode expects Uint8Array');
  }
  if (bytes.length === 0) return '';

  // 前导 0 字节 → 前导 '1'
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // 字节串 → 大端整数（BigInt）
  let n = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    n = n * 256n + BigInt(bytes[i]);
  }

  // 大端整数 → base-58 数位
  const digits = [];
  while (n > 0n) {
    const r = n % 58n;
    digits.push(Number(r));
    n = n / 58n;
  }
  digits.reverse();

  let str = '1'.repeat(zeros);
  for (const d of digits) str += BASE58_ALPHABET[d];
  return str;
}

/**
 * Base58 解码为字节串。失败抛 Error。
 *
 * 字符串 → base-58 大端整数 → 字节串：前导 '1' 解码为前导 0 字节。
 */
export function base58Decode(str) {
  if (typeof str !== 'string') throw new TypeError('base58Decode expects string');
  if (str.length === 0) return new Uint8Array(0);

  // 前导 '1' → 前导 0 字节
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros += 1;

  // base-58 → 大端整数（BigInt）
  let n = 0n;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    const digit = c < 128 ? BASE58_MAP[c] : -1;
    if (digit < 0) throw new Error(`Invalid Base58 character at index ${i}: ${str[i]}`);
    n = n * 58n + BigInt(digit);
  }

  // 大端整数 → 字节串
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n = n / 256n;
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[zeros + i] = bytes[i];
  }
  return out;
}

/**
 * Base58Check 编码：payload（任意字节） + sha256(sha256(payload)) 前 4 字节 → Base58 编码。
 */
export function base58CheckEncode(payloadBytes) {
  if (!(payloadBytes instanceof Uint8Array)) {
    throw new TypeError('base58CheckEncode expects Uint8Array');
  }
  const checksum = computeChecksum(payloadBytes);
  const combined = new Uint8Array(payloadBytes.length + 4);
  combined.set(payloadBytes, 0);
  combined.set(checksum, payloadBytes.length);
  return base58Encode(combined);
}

/**
 * Base58Check 解码：返回 payload（不含校验和）。失败抛 Error。
 */
export function base58CheckDecode(str) {
  const decoded = base58Decode(str);
  if (decoded.length < 4) throw new Error('Base58Check decoded payload too short');
  const payload = decoded.slice(0, decoded.length - 4);
  const expectedChecksum = decoded.slice(decoded.length - 4);
  const actualChecksum = computeChecksum(payload);
  for (let i = 0; i < 4; i += 1) {
    if (expectedChecksum[i] !== actualChecksum[i]) {
      throw new Error('Base58Check checksum mismatch');
    }
  }
  return payload;
}

/**
 * Base58Check 校验：仅判断解码 + 校验和是否匹配，不返回 payload。
 */
export function base58CheckVerify(str) {
  try {
    base58CheckDecode(str);
    return true;
  } catch {
    return false;
  }
}

function computeChecksum(payload) {
  // ethers.sha256 输入为 hex 字符串或 Uint8Array；返回 hex 字符串
  const first = ethers.sha256(payload);
  const second = ethers.sha256(first.startsWith('0x') ? first : `0x${first}`);
  const hex = second.startsWith('0x') ? second.slice(2) : second;
  return hexToBytes(hex.slice(0, 8));
}

// ===== Tron 专用入口 =====
// Tron 21 字节 payload：1 字节 prefix（mainnet 0x41 / testnet 0xa0）+ 20 字节 keccak256(pubkey[64]).slice(-20)

export const TRON_MAINNET_PREFIX = 0x41;
export const TRON_SHASTA_PREFIX = 0xa0;
export const TRON_NILE_PREFIX = 0xa0;

/**
 * 编码 20 字节 hash 成 Tron 地址字符串（默认 mainnet prefix 0x41）。
 * @param {Uint8Array} hash20  20 字节 keccak256(pubkey[64]).slice(-20)
 * @param {number} [prefix]    默认 0x41；shasta/nile 用 0xa0
 */
export function trxBase58CheckEncode(hash20, prefix = TRON_MAINNET_PREFIX) {
  if (!(hash20 instanceof Uint8Array) || hash20.length !== 20) {
    throw new TypeError('trxBase58CheckEncode expects 20-byte Uint8Array');
  }
  const payload = new Uint8Array(21);
  payload[0] = prefix & 0xff;
  payload.set(hash20, 1);
  return base58CheckEncode(payload);
}

/**
 * 解码 Tron 地址为 20 字节 hash。校验 prefix（必须为 0x41 或 0xa0）。
 */
export function trxBase58CheckDecode(addr) {
  const payload = base58CheckDecode(addr);
  if (payload.length !== 21) {
    throw new Error(`Invalid Tron address payload length: ${payload.length}`);
  }
  const prefix = payload[0];
  if (prefix !== TRON_MAINNET_PREFIX && prefix !== TRON_SHASTA_PREFIX && prefix !== TRON_NILE_PREFIX) {
    throw new Error(`Invalid Tron address prefix: 0x${prefix.toString(16)}`);
  }
  return payload.slice(1);
}

/**
 * 校验 Tron 地址字符串是否合法（解码 + 校验和 + 合法 prefix）。
 */
export function trxBase58CheckVerify(addr) {
  try {
    trxBase58CheckDecode(addr);
    return true;
  } catch {
    return false;
  }
}

// ===== 工具导出 =====
export { bytesToHex, hexToBytes };