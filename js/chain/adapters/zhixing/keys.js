// @ts-check
/**
 * 知行图成员密钥(ed25519)。
 *
 * 两种派生规则(BIP-39 种子 = PBKDF2-HMAC-SHA512(助记词, "mnemonic" ‖ 附加口令, 2048 次)):
 *
 *   标准(新成员一律用这个):SLIP-0010 ed25519,路径 m/44'/1105'/account'/0'/0'
 *     1105 是 KnowDoGraph 在 SLIP-0044 的币种编号(satoshilabs/slips#2102)。
 *     与 `node keygen` 的默认规则逐字节一致;一组助记词可以派生多个账户。
 *   旧规则(只为兼容既有密钥):ed25519 种子 = BIP-39 种子的前 32 字节。
 *     一组助记词只对应一个账户,导出私钥等于交出主种子的一半。`node keygen --legacy` 生成的就是这种。
 *
 * 地址:知行图账户在链上以 ed25519 公钥(64 位小写十六进制)标识,账户编号(u64)由链分配,
 * 钱包不知道也不需要知道编号;网页在提交前用公钥向节点查到编号。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import nacl from '../../../../lib/nacl.js';
import { bytesToHex, hexToBytes } from './op.js';

export const KDG_COIN_TYPE = 1105;
export const ZHIXING_DERIVATION_STANDARD = 'standard';
export const ZHIXING_DERIVATION_LEGACY = 'legacy';

/** KDG 标准路径(文字形式,存进账户的 derivationPath)。 */
export function zhixingStandardPath(account = 0) {
  return `m/44'/${KDG_COIN_TYPE}'/${account}'/0'/0'`;
}

function hmacSha512(key, data) {
  return ethers.getBytes(ethers.computeHmac('sha512', key, data));
}

/**
 * SLIP-0010 ed25519 派生(各级硬化):返回路径末端的 32 字节种子。
 * @param {Uint8Array} seed
 * @param {number[]} path 不带硬化标志的各级索引
 */
export function slip10Ed25519(seed, path) {
  let I = hmacSha512(ethers.toUtf8Bytes('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('ZHIXING_BAD_PATH');
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0, false);
    I = hmacSha512(chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

function bip39Seed(mnemonic, passphrase = '') {
  const phrase = String(mnemonic || '').trim().split(/\s+/).join(' ');
  return ethers.getBytes(ethers.Mnemonic.fromPhrase(phrase, passphrase || '').computeSeed());
}

/**
 * 助记词 → 标准规则下第 account 个知行图账户的 ed25519 种子(0x 十六进制)。
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @param {number} [account]
 */
export function zhixingStandardSeedFromMnemonic(mnemonic, passphrase = '', account = 0) {
  return '0x' + bytesToHex(slip10Ed25519(bip39Seed(mnemonic, passphrase), [44, KDG_COIN_TYPE, account, 0, 0]));
}

/**
 * 旧规则:助记词 → 32 字节 ed25519 种子(0x 十六进制),即 BIP-39 种子的前 32 字节。
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {string}
 */
export function zhixingSeedFromMnemonic(mnemonic, passphrase = '') {
  return '0x' + bytesToHex(bip39Seed(mnemonic, passphrase).slice(0, 32));
}

/**
 * 32 字节种子(0x 十六进制)→ nacl KeyPair。
 * @param {string} seedHex
 */
export function zhixingKeypairFromSeed(seedHex) {
  const seed = hexToBytes(seedHex);
  if (seed.length !== 32) throw new Error('ZHIXING_BAD_SEED: 种子应为 32 字节');
  return nacl.sign.keyPair.fromSeed(seed);
}

/** 公钥(小写十六进制,64 位)——知行图账户的地址形式。 */
export function zhixingAddressFromSeed(seedHex) {
  return bytesToHex(zhixingKeypairFromSeed(seedHex).publicKey);
}

export function isZhixingAddress(address) {
  return /^[0-9a-f]{64}$/.test(String(address || ''));
}
