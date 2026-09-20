// @ts-check
/**
 * Bitcoin 地址派生 / 校验 / scriptPubKey 解析（bip122 / secp256k1 / coinType 0）
 *
 * 支持的地址类型：
 *   - P2PKH  (base58check, version 0x00 mainnet / 0x6f testnet)   1... / m.../n...
 *   - P2SH   (base58check, version 0x05 mainnet / 0xc4 testnet)   3... / 2...
 *   - P2WPKH (bech32,  witness v0, 20B program)                   bc1q... / tb1q...
 *   - P2WSH  (bech32,  witness v0, 32B program)                   bc1q...(长)
 *   - P2TR   (bech32m, witness v1, 32B x-only)                    bc1p... / tb1p...
 *
 * 发送方（本钱包账户）v1 固定用 **P2WPKH（native segwit）**——地址短、手续费低、
 * 签名路径为 BIP-143 witness sighash（见 transaction.js）。收件人可为上述任意类型
 * （addressToScriptPubKey 负责把任意地址解析成锁定脚本）。
 *
 * hash160 = ripemd160(sha256(pubkey))；用 vendored ethers 的 sha256 / ripemd160。
 * base58check 复用 lib/base58.js + sha256d checksum。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import { base58Encode, base58Decode } from '../../../../lib/base58.js';
import { bech32Encode, bech32Decode } from '../../../../lib/bech32.js';
import {
  BIP122_NAMESPACE,
  BIP122_COIN_TYPE,
  BIP122_REFERENCE_MAINNET,
  bip122Reference,
  bip122Hrp,
  bip122P2pkhVersion,
  bip122P2shVersion,
  chainKeyFromBip122Network
} from './chain-key-bridge.js';
import { registerBitcoinStrictValidator } from '../../../common/chain/address-normalize.js';

const DUST_THRESHOLD = 546n; // 标准 P2PKH dust（sat）

/** hex 字符串（可带 0x）→ Uint8Array。 */
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

/** Uint8Array → hex（无 0x）。 */
function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** SHA-256（Uint8Array → Uint8Array）。 */
export function sha256(bytes) {
  return hexToBytes(ethers.sha256(bytes));
}

/** double SHA-256。 */
export function hash256(bytes) {
  return sha256(sha256(bytes));
}

/** hash160 = ripemd160(sha256(bytes))。 */
export function hash160(bytes) {
  return hexToBytes(ethers.ripemd160(ethers.sha256(bytes)));
}

/**
 * base58check 编码（version byte + payload + 4B sha256d checksum）。
 * @param {number} version
 * @param {Uint8Array} payload
 */
function base58CheckEncode(version, payload) {
  const data = new Uint8Array(1 + payload.length);
  data[0] = version & 0xff;
  data.set(payload, 1);
  const checksum = hash256(data).slice(0, 4);
  const full = new Uint8Array(data.length + 4);
  full.set(data, 0);
  full.set(checksum, data.length);
  return base58Encode(full);
}

/**
 * base58check 解码，返回 { version, payload }。checksum 不符抛错。
 * @param {string} str
 * @returns {{version: number, payload: Uint8Array}}
 */
function base58CheckDecode(str) {
  const decoded = base58Decode(str);
  if (decoded.length < 5) throw new Error('base58check: too short');
  const data = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const expect = hash256(data).slice(0, 4);
  for (let i = 0; i < 4; i += 1) {
    if (checksum[i] !== expect[i]) throw new Error('base58check: checksum mismatch');
  }
  return { version: data[0], payload: data.slice(1) };
}

/**
 * 压缩公钥（33B，0x02/0x03 前缀）→ P2WPKH 地址（native segwit，本钱包发送方类型）。
 * @param {Uint8Array} compressedPubkey 33 字节
 * @param {string} reference mainnet / testnet
 * @returns {string} bc1q... / tb1q...
 */
export function pubkeyToP2wpkhAddress(compressedPubkey, reference = BIP122_REFERENCE_MAINNET) {
  if (!(compressedPubkey instanceof Uint8Array) || compressedPubkey.length !== 33) {
    throw new Error('pubkeyToP2wpkhAddress: expects 33-byte compressed pubkey');
  }
  const h160 = hash160(compressedPubkey);
  return bech32Encode(bip122Hrp(reference), Array.from(h160), 0, 'bech32');
}

/**
 * 压缩公钥 → P2PKH 地址（legacy，供展示 / 兼容）。
 * @param {Uint8Array} compressedPubkey
 * @param {string} reference
 */
export function pubkeyToP2pkhAddress(compressedPubkey, reference = BIP122_REFERENCE_MAINNET) {
  const h160 = hash160(compressedPubkey);
  return base58CheckEncode(bip122P2pkhVersion(reference), h160);
}

/**
 * ethers.Wallet（secp256k1）私钥 hex → P2WPKH 地址。
 * 复用 ethers SigningKey 取压缩公钥。
 * @param {string} privateKeyHex 0x...
 * @param {string} reference
 */
export function privateKeyToBitcoinAddress(privateKeyHex, reference = BIP122_REFERENCE_MAINNET) {
  const signingKey = new ethers.SigningKey(privateKeyHex);
  const compressed = hexToBytes(signingKey.compressedPublicKey);
  return pubkeyToP2wpkhAddress(compressed, reference);
}

/**
 * 校验 Bitcoin 地址（P2PKH / P2SH base58check 或 bech32/bech32m witness）。
 * v1 只做结构 + checksum 校验，不强绑定 reference（跨网导入宽松）。
 * @param {string} value
 * @returns {boolean}
 */
export function isValidBitcoinAddress(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  // bech32 / bech32m
  if (/^(bc|tb)1/i.test(s)) {
    try {
      const dec = bech32Decode(s);
      if (dec.version === 0) return dec.data.length === 20 || dec.data.length === 32;
      if (dec.version === 1) return dec.data.length === 32;
      return dec.data.length >= 2 && dec.data.length <= 40;
    } catch {
      return false;
    }
  }
  // base58check P2PKH / P2SH
  try {
    const { version, payload } = base58CheckDecode(s);
    if (payload.length !== 20) return false;
    return version === 0x00 || version === 0x6f || version === 0x05 || version === 0xc4;
  } catch {
    return false;
  }
}

// 注入 Bitcoin 严格校验器给 common/address-normalize（避免 common → chain 反向依赖）。
registerBitcoinStrictValidator(isValidBitcoinAddress);

/**
 * 把任意 Bitcoin 地址解析成 scriptPubKey（锁定脚本字节）。
 * 用于构造交易输出。
 * @param {string} address
 * @returns {Uint8Array}
 */
export function addressToScriptPubKey(address) {
  const s = String(address || '').trim();
  if (/^(bc|tb)1/i.test(s)) {
    const dec = bech32Decode(s);
    const program = Uint8Array.from(dec.data);
    // witness program: OP_<version> || push(len) || program
    // OP_0 = 0x00；OP_1..OP_16 = 0x51..0x60
    const opVersion = dec.version === 0 ? 0x00 : 0x50 + dec.version;
    const out = new Uint8Array(2 + program.length);
    out[0] = opVersion;
    out[1] = program.length;
    out.set(program, 2);
    return out;
  }
  const { version, payload } = base58CheckDecode(s);
  if (version === 0x00 || version === 0x6f) {
    // P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    const out = new Uint8Array(25);
    out[0] = 0x76; out[1] = 0xa9; out[2] = 0x14;
    out.set(payload, 3);
    out[23] = 0x88; out[24] = 0xac;
    return out;
  }
  if (version === 0x05 || version === 0xc4) {
    // P2SH: OP_HASH160 <20> OP_EQUAL
    const out = new Uint8Array(23);
    out[0] = 0xa9; out[1] = 0x14;
    out.set(payload, 2);
    out[22] = 0x87;
    return out;
  }
  throw new Error(`addressToScriptPubKey: unsupported address version 0x${version.toString(16)}`);
}

/**
 * P2WPKH 地址 → 20B hash160（用于构造 BIP-143 scriptCode）。
 * 只接受本钱包发送方类型（native segwit v0, 20B program）。
 * @param {string} address
 * @returns {Uint8Array}
 */
export function p2wpkhAddressToHash160(address) {
  const dec = bech32Decode(String(address || '').trim());
  if (dec.version !== 0 || dec.data.length !== 20) {
    throw new Error('p2wpkhAddressToHash160: not a P2WPKH address');
  }
  return Uint8Array.from(dec.data);
}

/** 展示截断（前 6 + 后 4）。 */
export function displayBitcoinAddress(addr) {
  const s = String(addr || '').trim();
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

// 复用给 transaction.js
export { DUST_THRESHOLD, hexToBytes, bytesToHex, base58CheckEncode, base58CheckDecode };

// 重新导出 namespace 常量 + chainKey helper（index.js / vault 引用）
export {
  BIP122_NAMESPACE,
  BIP122_COIN_TYPE,
  bip122Reference,
  chainKeyFromBip122Network
};
