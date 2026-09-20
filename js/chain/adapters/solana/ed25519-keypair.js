// @ts-check
/**
 * Solana (ed25519) keypair helper
 *
 * wallet v1 简化：Solana 账户的私钥字节（32 字节）直接当作 ed25519 seed。
 * 这条路径与 secp256k1 私钥**字节相同但曲线不同**——给一个 Hardhat 私钥既能
 * 派生 EVM 地址又能派生 Solana 地址。
 *
 * 生产应走 SLIP-0010 ed25519 HD（m/44'/501'/0'/0/0），但 wallet v1 优先兼容
 * "导入同一私钥到多链" 的用户场景。
 */

import nacl from '../../../../lib/nacl.js';

/**
 * 把 secp256k1 私钥 hex (0x + 64 hex) 当成 ed25519 seed → nacl KeyPair。
 * @param {string} privateKeyHex
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }} nacl KeyPair
 */
export function ed25519KeypairFromSecp256k1Hex(privateKeyHex) {
  const raw = String(privateKeyHex || '').trim();
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ed25519KeypairFromSecp256k1Hex: expects 0x + 64 hex chars');
  }
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return nacl.sign.keyPair.fromSeed(seed);
}

/**
 * 直接从 32 字节 Uint8Array seed → KeyPair（包装 nacl API 以保持导入风格统一）。
 * @param {Uint8Array} seed
 */
export function naclFromEd25519Seed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error('naclFromEd25519Seed: seed must be 32 bytes');
  }
  return nacl.sign.keyPair.fromSeed(seed);
}