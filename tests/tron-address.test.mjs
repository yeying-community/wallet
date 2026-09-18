/**
 * chain/adapters/tron/address 单测
 * 运行：node --test tests/tron-address.test.mjs
 *
 * 覆盖：
 *  - 私钥 → Tron 地址的确定性派生（两个公开测试向量）
 *  - pubkey 字符串 / Uint8Array 输入形式
 *  - 公私钥校验（参数错误抛错）
 *  - isValidTronAddress：合法地址 true，坏 checksum / 非 Base58 字符集 / 空 false
 *  - isValidTronAddressForReference：mainnet / shasta / nile prefix 区分
 *  - chain-key bridge：reference 验证、chainKey 派生
 *  - tronPrefixForReference：reference → 字节前缀映射
 *  - HD 派生：m/44'/195'/0'/0/{0,1} 的确定性
 *  - 与 EVM 同曲线：私钥对应 EVM 地址 vs Tron 地址互不影响
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pubkeyToTronAddress,
  privateKeyToTronAddress,
  isValidTronAddress,
  isValidTronAddressForReference,
  tronPrefixForReference,
  deriveTronChildPrivateKey,
  TRON_ADDRESS_PREFIX_MAINNET,
  TRON_ADDRESS_PREFIX_TESTNET,
  TRON_DERIVATION_PATH
} from '../js/chain/adapters/tron/address.js';
import {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  isValidTronReference,
  chainKeyFromTronNetwork,
  tronReference
} from '../js/chain/adapters/tron/chain-key-bridge.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

// 已知公开测试向量（与 tron-base58check.test.mjs 中保持一致）
const PRIV_HEX_1 = '0x8e812436a0e3323166e1f0e8ba79e19e217b2c4a53c970d4cca0cfb1078979df';
const TRON_ADDR_1 = 'THKrowiEfCe8evdbaBzDDvQjM5DGeB3s3F';
const PRIV_HEX_2 = '0x13B9751EDFC5F25ABCB6AE0A8DF387C0B473CF52D8A71125358EBC735F157ABA';
const TRON_ADDR_2 = 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x';

// Hardhat 公开助记词
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
// 对应前 2 个 EVM 派生地址（已知）
const EVM_ADDR_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EVM_ADDR_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// ==================== 常量 ====================

test('prefix 常量：mainnet 0x41 / testnet 0xa0', () => {
  assert.equal(TRON_ADDRESS_PREFIX_MAINNET, 0x41);
  assert.equal(TRON_ADDRESS_PREFIX_TESTNET, 0xa0);
});

test('TRON_DERIVATION_PATH：m/44\'/195\'/0\'/0/{index}', () => {
  assert.equal(TRON_DERIVATION_PATH(0), "m/44'/195'/0'/0/0");
  assert.equal(TRON_DERIVATION_PATH(1), "m/44'/195'/0'/0/1");
});

// ==================== privateKeyToTronAddress ====================

test('privateKeyToTronAddress：priv_1 → 公开地址 TRON_ADDR_1', () => {
  assert.equal(privateKeyToTronAddress(PRIV_HEX_1), TRON_ADDR_1);
});

test('privateKeyToTronAddress：priv_2 → 公开地址 TRON_ADDR_2', () => {
  assert.equal(privateKeyToTronAddress(PRIV_HEX_2), TRON_ADDR_2);
});

test('privateKeyToTronAddress：testnet prefix 0xa0 → 同样 hash 不同地址', () => {
  // 同一私钥同样 hash，但 mainnet/testnet prefix 不同 → 地址不同
  const mainnet = privateKeyToTronAddress(PRIV_HEX_1);
  const testnet = privateKeyToTronAddress(PRIV_HEX_1, TRON_ADDRESS_PREFIX_TESTNET);
  assert.notEqual(mainnet, testnet, 'mainnet/testnet prefix 改变地址');
});

test('privateKeyToTronAddress：非法私钥抛错', () => {
  assert.throws(() => privateKeyToTronAddress('0x1234'), /0x \+ 64 hex/);
  assert.throws(() => privateKeyToTronAddress('not-a-key'), /0x \+ 64 hex/);
  assert.throws(() => privateKeyToTronAddress(null), /0x \+ 64 hex/);
});

// ==================== pubkeyToTronAddress ====================

test('pubkeyToTronAddress：0x + 130 hex → TRON_ADDR_1', () => {
  const sk = new ethers.SigningKey(PRIV_HEX_1);
  // signingKey.publicKey = 0x04 + 64 hex = 130 hex chars (with 0x prefix = 132)
  assert.equal(pubkeyToTronAddress(sk.publicKey), TRON_ADDR_1);
});

test('pubkeyToTronAddress：Uint8Array(64) 输入 → 一致地址', () => {
  const sk = new ethers.SigningKey(PRIV_HEX_1);
  const bytes = ethers.getBytes(sk.publicKey); // 0x04 + 64 hex = 65 bytes
  // 去掉首字节 0x04 → 64 字节（真正的 X‖Y）
  const xy = bytes.slice(1);
  assert.equal(xy.length, 64);
  assert.equal(pubkeyToTronAddress(xy), TRON_ADDR_1);
});

test('pubkeyToTronAddress：长度非法抛错', () => {
  assert.throws(() => pubkeyToTronAddress('0x1234'), /130 chars/);
  assert.throws(() => pubkeyToTronAddress(new Uint8Array(63)), /64 bytes/);
  assert.throws(() => pubkeyToTronAddress(new Uint8Array(65)), /64 bytes/);
  assert.throws(() => pubkeyToTronAddress(null), /hex string or Uint8Array/);
  assert.throws(() => pubkeyToTronAddress(123), /hex string or Uint8Array/);
});

// ==================== isValidTronAddress ====================

test('isValidTronAddress：合法已知地址 → true', () => {
  assert.equal(isValidTronAddress(TRON_ADDR_1), true);
  assert.equal(isValidTronAddress(TRON_ADDR_2), true);
});

test('isValidTronAddress：坏 checksum → false', () => {
  // 翻转最后一位（字符集内）的地址
  const last = TRON_ADDR_1[TRON_ADDR_1.length - 1];
  const tampered = TRON_ADDR_1.slice(0, -1) + (last === 'A' ? 'B' : 'A');
  assert.equal(isValidTronAddress(tampered), false);
});

test('isValidTronAddress：非法字符集 → false', () => {
  assert.equal(isValidTronAddress('hello world 12345'), false);
  // 长度不对
  assert.equal(isValidTronAddress('TA4Y62o6YC2Zsck9rZVGTvqW1AQ7X9zTn'), false);
});

test('isValidTronAddress：null / 空 / 非字符串 → false', () => {
  assert.equal(isValidTronAddress(null), false);
  assert.equal(isValidTronAddress(''), false);
  assert.equal(isValidTronAddress(undefined), false);
});

// ==================== isValidTronAddressForReference ====================

test('isValidTronAddressForReference：mainnet 接受 0x41 prefix 地址', () => {
  assert.equal(isValidTronAddressForReference(TRON_ADDR_1, 'mainnet'), true);
});

test('isValidTronAddressForReference：mainnet 拒绝 0xa0 prefix 地址', () => {
  const testnet = privateKeyToTronAddress(PRIV_HEX_1, TRON_ADDRESS_PREFIX_TESTNET);
  assert.equal(isValidTronAddressForReference(testnet, 'mainnet'), false);
});

test('isValidTronAddressForReference：testnet (shasta/nile) 接受 0xa0 prefix 地址', () => {
  const testnet = privateKeyToTronAddress(PRIV_HEX_1, TRON_ADDRESS_PREFIX_TESTNET);
  assert.equal(isValidTronAddressForReference(testnet, 'shasta'), true);
  assert.equal(isValidTronAddressForReference(testnet, 'nile'), true);
});

test('isValidTronAddressForReference：非法 reference → false', () => {
  assert.equal(isValidTronAddressForReference(TRON_ADDR_1, 'foo'), false);
  assert.equal(isValidTronAddressForReference(TRON_ADDR_1, ''), false);
});

// ==================== tronPrefixForReference ====================

test('tronPrefixForReference：reference → 字节前缀', () => {
  assert.equal(tronPrefixForReference('mainnet'), 0x41);
  assert.equal(tronPrefixForReference('shasta'), 0xa0);
  assert.equal(tronPrefixForReference('nile'), 0xa0);
});

test('tronPrefixForReference：非法 reference 抛错', () => {
  assert.throws(() => tronPrefixForReference('foo'), /Invalid tron reference/);
  assert.throws(() => tronPrefixForReference(''), /Invalid tron reference/);
});

// ==================== chain-key bridge ====================

test('isValidTronReference：合法 / 非法', () => {
  assert.equal(isValidTronReference('mainnet'), true);
  assert.equal(isValidTronReference('shasta'), true);
  assert.equal(isValidTronReference('nile'), true);
  assert.equal(isValidTronReference('MAINNET'), true, '大小写无关');
  assert.equal(isValidTronReference('foo'), false);
  assert.equal(isValidTronReference(''), false);
});

test('chainKeyFromTronNetwork：reference → tron:<ref>', () => {
  assert.equal(chainKeyFromTronNetwork({ reference: 'mainnet' }), 'tron:mainnet');
  assert.equal(chainKeyFromTronNetwork({ reference: 'shasta' }), 'tron:shasta');
  assert.equal(chainKeyFromTronNetwork({ reference: 'nile' }), 'tron:nile');
  assert.equal(chainKeyFromTronNetwork({ reference: 'SHASTA' }), 'tron:shasta', '大小写无关');
});

test('chainKeyFromTronNetwork：缺失或非法 reference 抛错', () => {
  assert.throws(() => chainKeyFromTronNetwork({}), /requires reference/);
  assert.throws(() => chainKeyFromTronNetwork({ reference: 'foo' }), /Invalid tron reference/);
});

test('tronReference：tron:<ref> → ref，非 tron 抛错', () => {
  assert.equal(tronReference('tron:mainnet'), 'mainnet');
  assert.equal(tronReference('tron:shasta'), 'shasta');
  assert.throws(() => tronReference('eip155:1'), /Unsupported chain namespace/);
  assert.throws(() => tronReference('tron:foo'), /Invalid tron reference/);
  assert.throws(() => tronReference('no-colon'), /Invalid chainKey/);
});

test('namespace 字面值：tron / mainnet / shasta / nile', () => {
  assert.equal(TRON_NAMESPACE, 'tron');
  assert.equal(TRON_REFERENCE_MAINNET, 'mainnet');
  assert.equal(TRON_REFERENCE_SHASTA, 'shasta');
  assert.equal(TRON_REFERENCE_NILE, 'nile');
});

// ==================== HD 派生 ====================

test('deriveTronChildPrivateKey：Hardhat 助记词 m/44\'/195\'/0\'/0/0', () => {
  const priv = deriveTronChildPrivateKey(TEST_MNEMONIC, 0);
  assert.match(priv, /^0x[0-9a-fA-F]{64}$/);
  // 派生出的地址应与已知 EVM 派生地址 0 对应的私钥派生出的 Tron 地址一致
  const tronAddr = privateKeyToTronAddress(priv);
  assert.match(tronAddr, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
});

test('deriveTronChildPrivateKey：Hardhat 助记词 index=1 派生确定性私钥', () => {
  const priv0 = deriveTronChildPrivateKey(TEST_MNEMONIC, 0);
  const priv1 = deriveTronChildPrivateKey(TEST_MNEMONIC, 1);
  assert.notEqual(priv0, priv1);
  // 同一助记词多次派生应确定性一致
  assert.equal(priv0, deriveTronChildPrivateKey(TEST_MNEMONIC, 0));
});

test('deriveTronChildPrivateKey：与 EVM HD 派生独立（m/44\'/60\' vs m/44\'/195\'）', () => {
  // EVM 派生路径 m/44'/60'/0'/0/0
  const hdEVM = ethers.HDNodeWallet.fromPhrase(TEST_MNEMONIC);
  const evmKey = hdEVM.privateKey; // ethers HDNodeWallet.fromPhrase 默认到 m/44'/60'/0'/0/0
  const tronKey = deriveTronChildPrivateKey(TEST_MNEMONIC, 0);
  // 不同路径应派生出不同私钥
  assert.notEqual(evmKey, tronKey);
  // 两者都能得到对应的 EVM / Tron 地址
  const evmAddr = ethers.computeAddress(evmKey);
  const tronAddr = privateKeyToTronAddress(tronKey);
  assert.equal(evmAddr.toLowerCase(), EVM_ADDR_0.toLowerCase(), 'EVM 派生地址匹配 Hardhat 公开向量');
  assert.match(tronAddr, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
});

// ==================== 与 EVM 路径关系 ====================

test('同一私钥：EVM 0x... 地址 vs Tron T... 地址互不影响', () => {
  const evm = ethers.computeAddress(PRIV_HEX_1);
  const tron = privateKeyToTronAddress(PRIV_HEX_1);
  assert.equal(evm.toLowerCase(), '0x50b0c2b3bcad53eb45b57c4e5df8a9890d002cc8');
  assert.equal(tron, TRON_ADDR_1);
});