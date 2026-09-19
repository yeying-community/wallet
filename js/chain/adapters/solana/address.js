// @ts-check
/**
 * Solana 地址派生（ed25519 / SLIP-44 coinType 501）
 *
 * - 私钥：32 字节 ed25519 seed（v1 简化：与 secp256k1 私钥字节复用同一份，
 *   直接 `nacl.sign.keyPair.fromSeed(hexBytes)`）。
 * - 公钥：32 字节 ed25519 pubkey。
 * - 地址：base58(32B pubkey)，无 checksum。
 *
 * HD 派生路径：`m/44'/501'/<account>'/0'/<index>`（SLIP-0010 + BIP-44）。
 * ethers.HDNodeWallet 默认走 secp256k1 m/44'/60'/0'/0/0；这里手动
 * derivePath 走 solana 完整路径。
 *
 * 与 Tron 路径的区别：Tron 复用 secp256k1 + 单独 base58check；Solana 是独立
 * 曲线 + 独立 cache（state.ed25519Keyring），见 keyring.js。
 */

import nacl from '../../../../lib/nacl.js';
import { base58Decode, base58Encode } from '../../../../lib/base58.js';
import { registerSolanaStrictValidator } from '../../../common/chain/address-normalize.js';
import {
  SOLANA_NAMESPACE,
  SOLANA_REFERENCE_MAINNET,
  SOLANA_REFERENCE_DEVNET,
  SOLANA_REFERENCE_TESTNET,
  isValidSolanaReference,
  chainKeyFromSolanaNetwork,
  solanaReference
} from './chain-key-bridge.js';

// 重新导出 namespace 常量。
export {
  SOLANA_NAMESPACE,
  SOLANA_REFERENCE_MAINNET,
  SOLANA_REFERENCE_DEVNET,
  SOLANA_REFERENCE_TESTNET,
  isValidSolanaReference,
  chainKeyFromSolanaNetwork,
  solanaReference
};

// common/chain/address-normalize.js 的 Solana 严格校验走注入模式；
// 此模块加载时主动注册一次（重复注册幂等）。
registerSolanaStrictValidator((value) => {
  try {
    const decoded = base58Decode(value);
    return decoded.length === 32;
  } catch {
    return false;
  }
});

// ===== SLIP-44 / BIP-44 派生常量 =====
export const SOLANA_COIN_TYPE = 501;
/** @param {number} [account=0] @param {number} [index=0] */
export const SOLANA_DERIVATION_PATH = (account = 0, index = 0) => `m/44'/501'/${account}'/0'/${index}`;

/**
 * 32 字节 ed25519 pubkey → base58 address。
 * @param {Uint8Array} pubkey
 * @returns {string}
 */
export function pubkeyToSolanaAddress(pubkey) {
  if (!(pubkey instanceof Uint8Array) || pubkey.length !== 32) {
    throw new Error('pubkeyToSolanaAddress: pubkey must be 32 bytes');
  }
  return base58Encode(pubkey);
}

/**
 * 32 字节 ed25519 seed → base58 address。
 *
 * 接受两种入参：
 *   - Uint8Array（32 字节）
 *   - hex string（`0x + 64 hex` 或纯 64 hex）
 *
 * @param {Uint8Array|string} seedOrHex
 * @returns {string}
 */
export function privateKeyToSolanaAddress(seedOrHex) {
  let seed;
  if (seedOrHex instanceof Uint8Array) {
    if (seedOrHex.length !== 32) {
      throw new Error('privateKeyToSolanaAddress: seed must be 32 bytes');
    }
    seed = seedOrHex;
  } else if (typeof seedOrHex === 'string') {
    const raw = seedOrHex.trim();
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('privateKeyToSolanaAddress: hex string must be 0x + 64 hex chars (or 64 hex chars)');
    }
    seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  } else {
    throw new TypeError('privateKeyToSolanaAddress expects Uint8Array or hex string');
  }
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return base58Encode(kp.publicKey);
}

/**
 * 字符串地址 → 32 字节 ed25519 pubkey。失败抛错。
 * @param {string} addr
 * @returns {Uint8Array}
 */
export function solanaAddressToPubkey(addr) {
  const decoded = base58Decode(String(addr || '').trim());
  if (decoded.length !== 32) {
    throw new Error(`solanaAddressToPubkey: invalid address (got ${decoded.length} bytes, want 32)`);
  }
  return decoded;
}

/**
 * 校验 Solana 地址：base58 解码 + 长度 32 字节。
 * @param {string} value
 * @returns {boolean}
 */
export function isValidSolanaAddress(value) {
  try {
    const decoded = base58Decode(String(value || '').trim());
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * 截断显示（6 + 4）。
 * @param {string} addr
 * @returns {string}
 */
export function displaySolanaAddress(addr) {
  const s = String(addr || '').trim();
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * 从 secp256k1 私钥 hex（0x + 64 hex）派生 ed25519 seed 32 字节。
 * v1 简化：直接把 32 字节私钥当 ed25519 seed，不走 SLIP-0010。
 * （生产应走 SLIP-0010 ed25519 HD，但 wallet v1 与 Hardhat/Anvil 测试链共享
 * 同一私钥场景更普遍；记录在 docs 留作 v2 升级点。）
 *
 * @param {string} privateKeyHex
 * @returns {Uint8Array}
 */
export function ethPrivateKeyToSolanaSeed(privateKeyHex) {
  const raw = String(privateKeyHex || '').trim();
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ethPrivateKeyToSolanaSeed: expects 0x + 64 hex chars');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}