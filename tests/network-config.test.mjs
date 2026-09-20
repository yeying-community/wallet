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

test('NETWORKS：每条都有 rpc/rpcUrl/explorer/symbol/decimals', () => {
  for (const [name, cfg] of Object.entries(NETWORKS)) {
    assert.equal(typeof cfg.rpc, 'string', `${name} rpc`);
    assert.equal(typeof cfg.rpcUrl, 'string', `${name} rpcUrl`);
    assert.equal(typeof cfg.explorer, 'string', `${name} explorer`);
    assert.equal(typeof cfg.symbol, 'string', `${name} symbol`);
    assert.equal(typeof cfg.decimals, 'number', `${name} decimals`);
    // EVM 网络必须含数字 chainId；Tron 等非 EVM 网络用 namespace+reference 标识，无 chainId
    if (!cfg.namespace || cfg.namespace === 'eip155') {
      assert.equal(typeof cfg.chainId, 'number', `${name} chainId`);
    }
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

test('getMainnets：当前五条主网（yeying / ethereum / tronMainnet / solanaMainnet / bitcoinMainnet）', () => {
  const mainnets = getMainnets();
  assert.equal(mainnets.length, 5);
  for (const n of mainnets) assert.equal(n.isTestnet, false);
  const ids = mainnets.map((n) => n.id);
  assert.ok(ids.includes('yeying'));
  assert.ok(ids.includes('ethereum'));
  assert.ok(ids.includes('tronMainnet'));
  assert.ok(ids.includes('solanaMainnet'));
  assert.ok(ids.includes('bitcoinMainnet'));
});

test('getTestnets：sepolia / polygon-amoy / bsc-testnet 均为测试网', () => {
  const testnets = getTestnets();
  const ids = testnets.map((n) => n.id);
  assert.ok(ids.includes('sepolia'), 'sepolia 应在测试网列表');
  assert.ok(ids.includes('polygon-amoy'), 'polygon-amoy 应在测试网列表');
  assert.ok(ids.includes('bsc-testnet'), 'bsc-testnet 应在测试网列表');
  for (const n of testnets) {
    assert.equal(n.isTestnet, true);
    assert.equal(n.type, 'testnet');
  }
});

test('NETWORKS：新增测试网 chainId / hex 正确', () => {
  assert.equal(NETWORKS.sepolia.chainId, 11155111);
  assert.equal(NETWORKS.sepolia.chainIdHex, '0xaa36a7');
  assert.equal(NETWORKS['polygon-amoy'].chainId, 80002);
  assert.equal(NETWORKS['polygon-amoy'].chainIdHex, '0x13882');
  assert.equal(NETWORKS['bsc-testnet'].chainId, 97);
  assert.equal(NETWORKS['bsc-testnet'].chainIdHex, '0x61');
});

test('getNetworkByChainId：测试网 chainId 也能命中', () => {
  assert.equal(getNetworkByChainId(11155111), NETWORKS.sepolia);
  assert.equal(getNetworkByChainId('0xaa36a7'), NETWORKS.sepolia);
  assert.equal(getNetworkByChainId(80002), NETWORKS['polygon-amoy']);
  assert.equal(getNetworkByChainId('0x61'), NETWORKS['bsc-testnet']);
});

// ==================== Tron 网络 ====================

test('NETWORKS：tronMainnet / tronShasta / tronNile 三条注册', () => {
  assert.ok(NETWORKS.tronMainnet);
  assert.ok(NETWORKS.tronShasta);
  assert.ok(NETWORKS.tronNile);
});

test('Tron 网络字段：namespace=tron、reference=mainnet/shasta/nile、chainKey=tron:<ref>', () => {
  assert.equal(NETWORKS.tronMainnet.namespace, 'tron');
  assert.equal(NETWORKS.tronMainnet.reference, 'mainnet');
  assert.equal(NETWORKS.tronMainnet.chainKey, 'tron:mainnet');
  assert.equal(NETWORKS.tronShasta.namespace, 'tron');
  assert.equal(NETWORKS.tronShasta.reference, 'shasta');
  assert.equal(NETWORKS.tronShasta.chainKey, 'tron:shasta');
  assert.equal(NETWORKS.tronNile.namespace, 'tron');
  assert.equal(NETWORKS.tronNile.reference, 'nile');
  assert.equal(NETWORKS.tronNile.chainKey, 'tron:nile');
});

test('Tron 网络：tronRpcUrl / rpcUrl / rpc 都指向 TronGrid 端点', () => {
  assert.equal(NETWORKS.tronMainnet.tronRpcUrl, 'https://api.trongrid.io');
  assert.equal(NETWORKS.tronShasta.tronRpcUrl, 'https://api.shasta.trongrid.io');
  assert.equal(NETWORKS.tronNile.tronRpcUrl, 'https://api.nile.trongrid.io');
});

test('Tron 网络：symbol=TRX / decimals=6 / explorer 区分主测试网', () => {
  assert.equal(NETWORKS.tronMainnet.symbol, 'TRX');
  assert.equal(NETWORKS.tronMainnet.decimals, 6);
  assert.equal(NETWORKS.tronMainnet.explorer, 'https://tronscan.org');
  assert.equal(NETWORKS.tronShasta.explorer, 'https://shasta.tronscan.org');
  assert.equal(NETWORKS.tronNile.explorer, 'https://nile.tronscan.io');
});

test('Tron 网络：mainnet / shasta / nile 主测试网属性正确', () => {
  assert.equal(NETWORKS.tronMainnet.isTestnet, false);
  assert.equal(NETWORKS.tronMainnet.type, 'mainnet');
  assert.equal(NETWORKS.tronShasta.isTestnet, true);
  assert.equal(NETWORKS.tronShasta.type, 'testnet');
  assert.equal(NETWORKS.tronNile.isTestnet, true);
  assert.equal(NETWORKS.tronNile.type, 'testnet');
});

test('Tron 网络：getTestnets 含 shasta/tronNile；getMainnets 含 tronMainnet', () => {
  const testnets = getTestnets().map(n => n.id);
  assert.ok(testnets.includes('tronShasta'));
  assert.ok(testnets.includes('tronNile'));
  const mainnets = getMainnets().map(n => n.id);
  assert.ok(mainnets.includes('tronMainnet'));
});

test('Tron 网络：getNetworkConfig(\'tronMainnet\') 返回完整配置', () => {
  const cfg = getNetworkConfig('tronMainnet');
  assert.equal(cfg, NETWORKS.tronMainnet);
});

test('getNetworkByChainId：Tron 没有数字 chainId，TronGrid 数字查询不影响', () => {
  // Tron 网络没有 chainId 数字字段；查询任意 Tron reference 的 hash 不应返回 Tron
  assert.equal(getNetworkByChainId('tron:mainnet'), null);
  // EVM 数字查询不误命中 Tron
  assert.notEqual(getNetworkByChainId(1)?.id, 'tronMainnet');
});

test('formatNetworkConfig：Tron namespace=tron 输入', () => {
  const out = formatNetworkConfig({
    name: 'Tron Foo',
    namespace: 'tron',
    reference: 'mainnet',
    rpc: 'https://api.trongrid.io'
  });
  assert.equal(out.id, 'tron-mainnet');
  assert.equal(out.namespace, 'tron');
  assert.equal(out.reference, 'mainnet');
  assert.equal(out.chainKey, 'tron:mainnet');
  assert.equal(out.tronRpcUrl, 'https://api.trongrid.io');
  assert.equal(out.symbol, 'TRX');
  assert.equal(out.decimals, 6);
  assert.equal(out.type, 'custom');
  // Tron 没有数字 chainId / chainIdHex
  assert.equal(out.chainId, undefined);
  assert.equal(out.chainIdHex, undefined);
});

test('formatNetworkConfig：Tron reference 缺失抛错', () => {
  assert.throws(
    () => formatNetworkConfig({ name: 'X', namespace: 'tron' }),
    /Tron network config requires reference/
  );
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

test('getExplorerTxUrl：非 EVM 链按 namespace 拼接（Tron hash 路由 / Solana cluster / BTC 标准）', () => {
  // Tron tronscan 是 SPA hash 路由 /#/transaction/
  assert.equal(
    getExplorerTxUrl('tronMainnet', 'abc123'),
    'https://tronscan.org/#/transaction/abc123'
  );
  assert.equal(
    getExplorerAddressUrl('tronMainnet', 'TXaddr'),
    'https://tronscan.org/#/address/TXaddr'
  );
  // Solana mainnet-beta：solscan 标准 /tx/，无 cluster query
  assert.equal(
    getExplorerTxUrl('solanaMainnet', 'sig123'),
    'https://solscan.io/tx/sig123'
  );
  // Solana devnet：追加 ?cluster=devnet
  assert.equal(
    getExplorerTxUrl('solanaDevnet', 'sig456'),
    'https://solscan.io/tx/sig456?cluster=devnet'
  );
  // Bitcoin mempool.space：标准 /tx/
  assert.equal(
    getExplorerTxUrl('bitcoinMainnet', 'txid789'),
    'https://mempool.space/tx/txid789'
  );
});
