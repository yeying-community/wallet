// @ts-check
/**
 * 知行图成员密钥(ed25519)。
 *
 * 派生规则与知行图自己的工具**完全相同**(`node keygen`、知行图浏览器「我的身份」):
 *   BIP-39 种子 = PBKDF2-HMAC-SHA512(助记词, "mnemonic" ‖ 附加口令, 2048 次)
 *   ed25519 种子 = BIP-39 种子的前 32 字节
 * 所以同一组助记词导入钱包,得到的就是成员原来的那把密钥、那个链上账户。
 *
 * 代价:一组助记词只对应一个知行图账户(没有 HD 路径)。这是有意的选择——
 * 与既有成员身份兼容,比"一组助记词多个账户"更重要。
 *
 * 地址:知行图账户在链上以 ed25519 公钥(64 位小写十六进制)标识,账户编号(u64)由链分配,
 * 钱包不知道也不需要知道编号;网页在提交前用公钥向节点查到编号。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import nacl from '../../../../lib/nacl.js';
import { bytesToHex, hexToBytes } from './op.js';

/**
 * 助记词 → 32 字节 ed25519 种子(0x 十六进制)。
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {string}
 */
export function zhixingSeedFromMnemonic(mnemonic, passphrase = '') {
  const phrase = String(mnemonic || '').trim().split(/\s+/).join(' ');
  const m = ethers.Mnemonic.fromPhrase(phrase, passphrase || '');
  const seed = ethers.getBytes(m.computeSeed()); // 64 字节 BIP-39 种子
  return '0x' + bytesToHex(seed.slice(0, 32));
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
