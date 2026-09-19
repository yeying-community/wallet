// @ts-check
/**
 * BIP-173 bech32 / BIP-350 bech32m 编码（hand-rolled, ~120 LOC, 零依赖）
 *
 * 用法：
 *   bech32Encode(hrp, data, 'bech32' | 'bech32m') → string
 *   bech32Decode(str) → { hrp, data, version } （version=0 bech32, ≥1 bech32m）
 *
 * 用途：BTC P2WPKH（bech32，version 0，0x00 OP_0）、P2TR（bech32m，version 1，0x01 OP_1）。
 *
 * 算法：BIP-173 polymod = 1 → checksum with constant expansions; charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'；final checksum 是 polymod XOR 1（bech32m XOR 0x2bc830a3）。
 *
 * 不引 @scure/base / bitcoinjs-lib；wallet v1 仅需 encode（地址生成）+ decode（receive 校验）。
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

/**
 * @param {number} pre 5-bit 组展开前的 polymod
 */
function polymodStep(pre) {
  const b = pre >> 25;
  return ((pre & 0x1ffffff) << 5) ^
    (-((b >> 0) & 1) & 0x3b6a57b2) ^
    (-((b >> 1) & 1) & 0x26508e6d) ^
    (-((b >> 2) & 1) & 0x1ea119fa) ^
    (-((b >> 3) & 1) & 0x3d4233dd) ^
    (-((b >> 4) & 1) & 0x2a1462b3);
}

/**
 * 计算 hrpExpand + data 的 polymod（reduce 完返回值）。
 * bech32 校验：bech32Polymod(hrpExpand + data + checksum) === 1
 * bech32m 校验：bech32Polymod(hrpExpand + data + checksum) === 0x2bc830a3
 * → 编码时 checksum 6 个 5-bit 块 = polymod XOR constant
 * （constant = 1 for bech32, = 0x2bc830a3 for bech32m）。
 */
function bech32Polymod(values) {
  return values.reduce((p, v) => polymodStep(p) ^ v, 1);
}

/**
 * 生成 6 个 5-bit checksum。
 * @param {string} hrp
 * @param {ReadonlyArray<number>} data 5-bit 组（不含 checksum；调用方需 pre-pend version）
 * @param {number} constant
 */
function createChecksum(hrp, data, constant) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ constant;
  /** @type {number[]} */
  const ret = [];
  for (let i = 0; i < 6; i++) ret.push((mod >> (5 * (5 - i))) & 31);
  return ret;
}

/**
 * @param {string} hrp 人类可读部分（'bc' / 'tb' / 'bcrt'）
 */
function hrpExpand(hrp) {
  /** @type {number[]} */
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

/**
 * 校验 checksum；返回 { version, kind, valid }。
 * bech32 polymod final = 1（无 XOR）；bech32m polymod final = 0x2bc830a3
 * （无 XOR）。两者 verify 直接 compare。
 */
function verifyChecksum(hrp, data) {
  const mod = bech32Polymod([...hrpExpand(hrp), ...data]);
  if (mod === 1) return { version: data[0], kind: 'bech32', valid: true };
  if (mod === 0x2bc830a3) return { version: data[0], kind: 'bech32m', valid: true };
  return { version: -1, kind: null, valid: false };
}

/**
 * 8-bit 字节转 5-bit 组（BIP-173 风格，BigInt 防溢出）
 * @param {ReadonlyArray<number>} bytes 8-bit 输入
 */
function convertBits(bytes, from, to, pad) {
  let acc = 0n;
  let bits = 0;
  /** @type {number[]} */
  const ret = [];
  const maxv = (1 << to) - 1;
  const toBig = BigInt(to);
  const fromBig = BigInt(from);
  for (const b of bytes) {
    if (b < 0 || (b >> from) !== 0) throw new Error('convertBits: invalid byte');
    acc = (acc << fromBig) | BigInt(b);
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push(Number((acc >> BigInt(bits)) & BigInt(maxv)));
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push(Number((acc << (toBig - BigInt(bits))) & BigInt(maxv)));
    }
  } else if (((acc << (toBig - BigInt(bits))) & BigInt(maxv)) !== 0n) {
    // 末尾 padding bits 非 0 → 非法数据
    throw new Error('convertBits: non-zero padding');
  }
  // 末尾 padding bits = 0（BIP-173 / BIP-350 标准允许）静默通过
  return ret;
}

/**
 * 编码 bech32/bech32m。
 * @param {string} hrp
 * @param {ReadonlyArray<number>} dataBytes 8-bit 输入
 * @param {0|1|2} version 0 = bech32 (P2WPKH), 1 = bech32m (P2TR), 2 = bech32m (≥1)
 * @param {'bech32' | 'bech32m'} [kind]
 */
export function bech32Encode(hrp, dataBytes, version, kind = 'bech32') {
  const constant = kind === 'bech32' ? BECH32_CONST : BECH32M_CONST;
  const data5 = convertBits(dataBytes, 8, 5, true);
  const combined = [version, ...data5];
  const checksum = createChecksum(hrp, combined, constant);
  let ret = hrp + '1';
  for (const c of combined) ret += CHARSET[c];
  for (const c of checksum) ret += CHARSET[c];
  return ret;
}

/**
 * 解码 bech32/bech32m。
 * @param {string} str
 * @returns {{ hrp: string, data: number[], version: number, kind: 'bech32'|'bech32m' }}
 */
export function bech32Decode(str) {
  if (typeof str !== 'string') throw new Error('bech32Decode: must be string');
  const lower = str.toLowerCase();
  const upper = str.toUpperCase();
  if (lower !== upper && lower !== str) throw new Error('bech32Decode: mixed case');
  const pos = str.lastIndexOf('1');
  if (pos < 1) throw new Error('bech32Decode: no separator');
  if (pos + 7 > str.length) throw new Error('bech32Decode: too short');
  const hrp = str.slice(0, pos);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) throw new Error('bech32Decode: invalid hrp char');
  }
  const data = [];
  for (let i = pos + 1; i < str.length; i++) {
    const idx = CHARSET.indexOf(str[i].toLowerCase());
    if (idx === -1) throw new Error(`bech32Decode: invalid char "${str[i]}"`);
    data.push(idx);
  }
  const verif = verifyChecksum(hrp, data);
  if (!verif.valid) throw new Error('bech32Decode: invalid checksum');
  const version = data[0];
  // data = [version, ...program5, ...checksum6]；剥掉尾部 6 个 checksum symbol，
  // 否则 convertBits 会把 checksum 也当 witness program 解 → 长度漂移 + 非零 padding。
  const program = data.slice(1, data.length - 6);
  // kind 由 version 决定：0 = bech32，≥1 = bech32m
  const kind = verif.version === 0 ? 'bech32' : 'bech32m';
  const programBytes = convertBits(program, 5, 8, false);
  return { hrp, data: programBytes, version, kind };
}