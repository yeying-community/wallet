/**
 * Bitcoin-style Base58 编码（公开 domain，hand-rolled）
 *
 * 用法：base58Encode(bytes) / base58Decode(str)
 *
 * - 不含 Base58Check 校验和；Solana 地址是 base58(32B pubkey)，无 checksum。
 * - 字符集：'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
 *   （去除 0 / O / I / l 以避免视觉混淆）。
 * - 输入输出统一用 Uint8Array / string。
 *
 * 来源：参考 bitcoinjs-lib 的 base58 实现思路；纯手写不引依赖。
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = (() => {
  const m = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET.charCodeAt(i)] = i;
  return m;
})();

/**
 * Uint8Array → Base58 字符串。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('base58Encode expects Uint8Array');
  }
  if (bytes.length === 0) return '';

  // 统计前导 0 字节
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // base58 转换的"大数"在 JS 里用数组 [lo, hi] 表示
  const size = Math.ceil((bytes.length - zeros) * 138 / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }

  // 跳过前导 0（base58 用 '1' 表示）
  let it = size - length;
  while (it < size && b58[it] === 0) it++;

  let str = '1'.repeat(zeros);
  for (; it < size; it++) str += ALPHABET[b58[it]];
  return str;
}

/**
 * Base58 字符串 → Uint8Array。
 * @param {string} str
 * @returns {Uint8Array}
 */
export function base58Decode(str) {
  const s = String(str || '').trim();
  if (!s) return new Uint8Array(0);

  // 统计前导 '1'（对应 0 字节）
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;

  const size = Math.ceil(s.length * 733 / 1000) + 1;
  const b256 = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 128) throw new Error(`base58Decode: non-ASCII character at ${i}`);
    const digit = ALPHABET_MAP[c];
    if (digit < 0) throw new Error(`base58Decode: invalid character "${s[i]}" at ${i}`);
    let carry = digit;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * b256[k];
      b256[k] = carry & 0xff;
      carry >>= 8;
    }
    length = j;
  }

  // 跳过前导 0
  let it = size - length;
  while (it < size && b256[it] === 0) it++;

  const out = new Uint8Array(zeros + (size - it));
  out.fill(0, 0, zeros);
  for (let i = zeros; i < out.length; i++) out[i] = b256[it++];
  return out;
}