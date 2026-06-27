/**
 * config/network-config 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * 网络配置：默认/支持列表、主网 vs 测试网、chainId → 名称、explorer URL
 * 生成、formatNetworkConfig 规范化、isSameNetwork。
 * 错网络/错链会让切链失败、explorer 链接指向错误链。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NETWORK,
  NETWORKS,
  BUILTIN_TOKENS_BY_CHAIN_ID,
  NETWORK_TYPES,
  RPC_CONFIG,
  getNetworkConfig,
  getDefaultNetworkConfig,
  getNetworkByChainId,
  getNetworkNameByChainId,
  isNetworkSupported,
  getSupportedNetworks,
  getAllNetworks,
  getMainnets,
  getTestnets,
  formatNetworkConfig,
  isSameNetwork,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getExplorerBlockUrl
} from '../js/config/network-config.js';

const YEYING = NETWORKS.yeying;
const ETHEREUM = NETWORKS.ethereum;

// ==================== 数据完整性 ====================

test('DEFAULT_NETWORK = yeying 且存在于 NETWORKS', () => {
  assert.equal(DEFAULT_NETWORK, 'yeying');
  assert.ok(NETWORKS[DEFAULT_NETWORK]);
});

test('NETWORKS：YeYing chainId 5432 / 0x1538、ETH chainId 1 / 0x1', () => {
  assert.equal(YEYING.chainId, 5432);
  assert.equal(YEYING.chainIdHex, '0x1538');
  assert.equal(YEYING.type, NETWORK_TYPES.MAINNET);
  assert.equal(YEYING.isTestnet, false);
  assert.equal(ETHEREUM.chainId, 1);
  assert.equal(ETHEREUM.chainIdHex, '0x1');
  assert.equal(ETHEREUM.nativeCurrency.symbol, 'ETH');
});

test('NETWORKS：每条都有 chainId/rpc/rpcUrl/explorer/symbol/decimals', () => {
  for (const [name, cfg] of Object.entries(NETWORKS)) {
    assert.equal(typeof cfg.chainId, 'number', `${name} chainId`);
    assert.equal(typeof cfg.rpc, 'string', `${name} rpc`);
    assert.equal(typeof cfg.rpcUrl, 'string', `${name} rpcUrl`);
    assert.equal(typeof cfg.explorer, 'string', `${name} explorer`);
    assert.equal(typeof cfg.symbol, 'string', `${name} symbol`);
    assert.equal(typeof cfg.decimals, 'number', `${name} decimals`);
  }
});

test('NETWORK_TYPES 枚举：mainnet / testnet / custom', () => {
  assert.equal(NETWORK_TYPES.MAINNET, 'mainnet');
  assert.equal(NETWORK_TYPES.TESTNET, 'testnet');
  assert.equal(NETWORK_TYPES.CUSTOM, 'custom');
});

test('BUILTIN_TOKENS_BY_CHAIN_ID：主网 0x1 含 USDC/USDT（小写合约地址）', () => {
  const tokens = BUILTIN_TOKENS_BY_CHAIN_ID['0x1'];
  assert.ok(Array.isArray(tokens));
  const symbols = tokens.map((t) => t.symbol);
  assert.ok(symbols.includes('USDC'));
  assert.ok(symbols.includes('USDT'));
  // 小写地址：识别是同一地址，不应错写为校验和
  for (const t of tokens) {
    assert.match(t.address, /^0x[a-f0-9]{40}$/);
    assert.equal(t.builtin, true);
  }
});

test('RPC_CONFIG：必要字段存在且 > 0', () => {
  assert.ok(RPC_CONFIG.TIMEOUT > 0);
  assert.ok(RPC_CONFIG.MAX_RETRIES >= 0);
  assert.ok(RPC_CONFIG.RETRY_DELAY > 0);
  assert.ok(RPC_CONFIG.BATCH_SIZE > 0);
  assert.ok(RPC_CONFIG.CACHE_TTL > 0);
});

// ==================== getNetworkConfig ====================

test('getNetworkConfig：已知 / 未知', () => {
  assert.equal(getNetworkConfig('yeying'), YEYING);
  assert.equal(getNetworkConfig('unknown'), null);
  assert.equal(getNetworkConfig(null), null);
});

test('getDefaultNetworkConfig：返回 yeying', () => {
  assert.equal(getDefaultNetworkConfig(), YEYING);
});

// ==================== getNetworkByChainId / getNetworkNameByChainId ====================

test('getNetworkByChainId：number / 0x 字符串 / 十进制字符串均可', () => {
  assert.equal(getNetworkByChainId(1), ETHEREUM);
  assert.equal(getNetworkByChainId('0x1'), ETHEREUM);
  assert.equal(getNetworkByChainId('1'), ETHEREUM);
  assert.equal(getNetworkByChainId(5432), YEYING);
  assert.equal(getNetworkByChainId('0x1538'), YEYING);
  assert.equal(getNetworkByChainId(999999), null);
  assert.equal(getNetworkByChainId('not-a-num'), null);
});

test('getNetworkNameByChainId：返回 key 名（"yeying" / "ethereum"）', () => {
  assert.equal(getNetworkNameByChainId(1), 'ethereum');
  assert.equal(getNetworkNameByChainId('0x1'), 'ethereum');
  assert.equal(getNetworkNameByChainId(5432), 'yeying');
  assert.equal(getNetworkNameByChainId(999999), null);
});

// ==================== isNetworkSupported / getSupportedNetworks / getAllNetworks ====================

test('isNetworkSupported', () => {
  assert.equal(isNetworkSupported('yeying'), true);
  assert.equal(isNetworkSupported('ethereum'), true);
  assert.equal(isNetworkSupported('foo'), false);
  assert.equal(isNetworkSupported(null), false);
});

test('getSupportedNetworks：含 yeying 与 ethereum', () => {
  const list = getSupportedNetworks();
  assert.ok(list.includes('yeying'));
  assert.ok(list.includes('ethereum'));
});

test('getAllNetworks：长度 == getSupportedNetworks 长度', () => {
  assert.equal(getAllNetworks().length, getSupportedNetworks().length);
});

// ==================== getMainnets / getTestnets ====================

test('getMainnets：当前两条都是主网', () => {
  const mainnets = getMainnets();
  assert.equal(mainnets.length, 2);
  for (const n of mainnets) assert.equal(n.isTestnet, false);
});

test('getTestnets：当前没有测试网', () => {
  assert.deepEqual(getTestnets(), []);
});

// ==================== formatNetworkConfig ====================

test('formatNetworkConfig：补全 rpc/rpcUrl/chainIdHex/defaults', () => {
  const out = formatNetworkConfig({
    name: 'Polygon',
    chainId: 137,
    rpc: 'https://polygon-rpc.com',
    symbol: 'MATIC'
  });
  assert.equal(out.id, 'polygon', 'id 默认取 name 小写化');
  assert.equal(out.name, 'Polygon');
  assert.equal(out.chainId, 137);
  assert.equal(out.chainIdHex, '0x89');
  assert.equal(out.rpc, 'https://polygon-rpc.com');
  assert.equal(out.rpcUrl, 'https://polygon-rpc.com');
  assert.equal(out.symbol, 'MATIC');
  assert.equal(out.decimals, 18, 'decimals 默认 18');
  assert.equal(out.type, NETWORK_TYPES.CUSTOM);
  assert.equal(out.isTestnet, false);
  assert.deepEqual(out.nativeCurrency, { name: 'MATIC', symbol: 'MATIC', decimals: 18 });
});

test('formatNetworkConfig：chainId 为 0x 字符串也正确转换', () => {
  const out = formatNetworkConfig({
    name: 'BSC', chainId: '0x38', symbol: 'BNB', rpc: 'https://bsc'
  });
  assert.equal(out.chainId, 56);
  assert.equal(out.chainIdHex, '0x38');
});

test('formatNetworkConfig：自定义 explorer 与 decimals 透传', () => {
  const out = formatNetworkConfig({
    name: 'Test', chainId: 123, symbol: 'T', rpc: 'r', explorer: 'https://exp', decimals: 6
  });
  assert.equal(out.explorer, 'https://exp');
  assert.equal(out.decimals, 6);
});

// ==================== isSameNetwork ====================

test('isSameNetwork：同 chainId → true、null/缺失 → false', () => {
  assert.equal(isSameNetwork(YEYING, ETHEREUM), false);
  assert.equal(isSameNetwork(YEYING, { chainId: 5432 }), true);
  assert.equal(isSameNetwork(null, ETHEREUM), false);
  assert.equal(isSameNetwork(YEYING, null), false);
});

// ==================== explorer URL ====================

test('getExplorerAddressUrl / TxUrl / BlockUrl：已知网络 → 拼接', () => {
  assert.equal(
    getExplorerAddressUrl('yeying', '0xabc'),
    'https://blockscout.yeying.pub/address/0xabc'
  );
  assert.equal(
    getExplorerTxUrl('ethereum', '0x' + 'a'.repeat(64)),
    'https://etherscan.io/tx/0x' + 'a'.repeat(64)
  );
  assert.equal(
    getExplorerBlockUrl('yeying', 12345),
    'https://blockscout.yeying.pub/block/12345'
  );
});

test('getExplorer*Url：未知网络或 explorer 缺失 → 空串', () => {
  assert.equal(getExplorerAddressUrl('unknown', '0xabc'), '');
  assert.equal(getExplorerTxUrl(null, '0xabc'), '');
  assert.equal(getExplorerBlockUrl('', '123'), '');
});
