/**
 * js/chain/chain-key CAIP-2 转换纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * chainKey 是 state.currentChainKey（CAIP-2）与对外 EVM 协议 hex/十进制 chainId 之间
 * 的唯一转换收敛点。往返算错会破坏 eth_chainId / net_version / 网络切换。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NAMESPACE,
  DEFAULT_COIN_TYPE,
  chainKeyFromNetwork,
  chainKeyFromHex,
  chainKeyToHex,
  chainKeyToDecimal,
  namespaceOf,
  referenceOf,
  TRON_NAMESPACE
} from '../js/chain/chain-key.js';

test('常量', () => {
  assert.equal(DEFAULT_NAMESPACE, 'eip155');
  assert.equal(DEFAULT_COIN_TYPE, 60);
});

test('chainKeyFromHex / chainKeyToHex 往返：eip155:1 ↔ 0x1', () => {
  assert.equal(chainKeyFromHex('0x1'), 'eip155:1');
  assert.equal(chainKeyToHex('eip155:1'), '0x1');
});

test('chainKeyFromHex / chainKeyToHex 往返：eip155:5432 ↔ 0x1538', () => {
  assert.equal(chainKeyFromHex('0x1538'), 'eip155:5432');
  assert.equal(chainKeyToHex('eip155:5432'), '0x1538');
});

test('chainKeyFromHex：大写 0X / 大写 hex', () => {
  assert.equal(chainKeyFromHex('0X38'), 'eip155:56');
  assert.equal(chainKeyFromHex('0xA'), 'eip155:10');
});

test('chainKeyFromHex：十进制输入也接受', () => {
  assert.equal(chainKeyFromHex('137'), 'eip155:137');
});

test('chainKeyFromNetwork：number / hex / 十进制串 chainId', () => {
  assert.equal(chainKeyFromNetwork({ chainId: 1 }), 'eip155:1');
  assert.equal(chainKeyFromNetwork({ chainId: '0x38' }), 'eip155:56');
  assert.equal(chainKeyFromNetwork({ chainId: '137' }), 'eip155:137');
});

test('chainKeyFromNetwork：Tron network（namespace=tron + reference）', () => {
  assert.equal(chainKeyFromNetwork({ namespace: 'tron', reference: 'mainnet' }), 'tron:mainnet');
  assert.equal(chainKeyFromNetwork({ namespace: 'tron', reference: 'shasta' }), 'tron:shasta');
  assert.equal(chainKeyFromNetwork({ namespace: 'tron', reference: 'nile' }), 'tron:nile');
});

test('chainKeyToDecimal', () => {
  assert.equal(chainKeyToDecimal('eip155:1'), '1');
  assert.equal(chainKeyToDecimal('eip155:5432'), '5432');
});

test('namespaceOf', () => {
  assert.equal(namespaceOf('eip155:1'), 'eip155');
  assert.equal(namespaceOf('solana:mainnet'), 'solana');
  assert.equal(namespaceOf('tron:mainnet'), 'tron');
  assert.equal(namespaceOf('no-colon'), '');
});

test('referenceOf', () => {
  assert.equal(referenceOf('eip155:1'), '1');
  assert.equal(referenceOf('tron:mainnet'), 'mainnet');
  assert.equal(referenceOf('tron:shasta'), 'shasta');
  assert.equal(referenceOf('no-colon'), '');
});

test('TRON_NAMESPACE 暴露为常量', () => {
  assert.equal(TRON_NAMESPACE, 'tron');
});

test('非 eip155 命名空间在 hex/decimal 转换处抛错', () => {
  assert.throws(() => chainKeyToHex('solana:mainnet'), /Unsupported chain namespace/);
  assert.throws(() => chainKeyToDecimal('tron:mainnet'), /Unsupported chain namespace/);
});

test('非法输入抛错', () => {
  assert.throws(() => chainKeyFromHex('0xZZ'));
  assert.throws(() => chainKeyFromNetwork({ chainId: 'abc' }));
  assert.throws(() => chainKeyToHex('eip155:notanumber'));
});
