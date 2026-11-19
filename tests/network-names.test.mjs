/**
 * 网络显示名按界面语言(中文 / English)取。
 *
 * 守门点:
 *   - 每个内置网络都有中英文名,且两者都非空;
 *   - 名字在显示时从配置取:存储里那份副本即使还是旧名字(例如安装时的"知行图测试网"),也按当前语言显示;
 *   - 用户 / DApp 添加的网络用它自己的名字,不翻译;
 *   - 两份语言包的键一一对应,网络相关的键都在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome ||= { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } };

const { NETWORKS } = await import('../js/config/network-config.js');
const { getNetworkDisplayName, findBuiltinNetwork } = await import('../js/config/network-names.js');
const i18n = await import('../js/common/i18n/index.js');
const { messagesZhCN } = await import('../js/common/i18n/messages-zh-CN.js');
const { messagesEnUS } = await import('../js/common/i18n/messages-en-US.js');

async function inLocale(locale, fn) {
  await i18n.setLocale(locale);
  try { return await fn(); } finally { i18n.resetI18nForTests(); }
}

test('每个内置网络都有中英文名', () => {
  for (const [key, n] of Object.entries(NETWORKS)) {
    assert.ok(n.names?.['zh-CN'], `${key} 缺中文名`);
    assert.ok(n.names?.['en-US'], `${key} 缺英文名`);
    assert.equal(n.name, n.names['en-US'], `${key} 的 name 应是英文名`);
  }
  assert.equal(NETWORKS.zhixingTestnet.names['zh-CN'], '知行图测试网');
  assert.equal(NETWORKS.zhixingTestnet.names['en-US'], 'Knowing-Doing Graph Testnet');
});

test('存储里的旧名字不影响显示:按当前语言从配置取', async () => {
  // 已安装钱包里的副本:name 还是安装时的中文
  const stored = { ...NETWORKS.zhixingTestnet, key: 'zhixingTestnet', name: '知行图测试网' };
  assert.equal(await inLocale('en-US', () => getNetworkDisplayName(stored)), 'Knowing-Doing Graph Testnet');
  assert.equal(await inLocale('zh-CN', () => getNetworkDisplayName(stored)), '知行图测试网');
  const eth = { ...NETWORKS.ethereum, key: 'ethereum' };
  assert.equal(await inLocale('zh-CN', () => getNetworkDisplayName(eth)), '以太坊主网');
  assert.equal(await inLocale('en-US', () => getNetworkDisplayName(eth)), 'Ethereum Mainnet');
  // 只有 chainKey 也能认出(交易详情等场景)
  assert.equal(await inLocale('zh-CN', () => getNetworkDisplayName('tron:nile')), '波场 Nile 测试网');
});

test('自定义网络用自己的名字,不翻译;找不到名字时用当前语言的兜底', async () => {
  const custom = { chainId: '0x1538', chainName: 'My 5432', rpcUrl: 'https://example.invalid' };
  assert.equal(findBuiltinNetwork(custom), null);
  assert.equal(await inLocale('zh-CN', () => getNetworkDisplayName(custom)), 'My 5432');
  assert.equal(await inLocale('en-US', () => getNetworkDisplayName(custom)), 'My 5432');
  assert.equal(await inLocale('zh-CN', () => getNetworkDisplayName(null)), '网络');
  assert.equal(await inLocale('en-US', () => getNetworkDisplayName(null)), 'Network');
});

test('两份语言包的键一一对应,网络与知行图相关的键齐全', () => {
  const zh = Object.keys(messagesZhCN).sort();
  const en = Object.keys(messagesEnUS).sort();
  assert.deepEqual(zh, en);
  for (const k of ['network.generic', 'network.manage', 'network.family.zhixing', 'network.ref.testnet', 'zhixing.intro', 'zhixing.member']) {
    assert.ok(messagesZhCN[k] && messagesEnUS[k], k);
  }
  assert.equal(messagesEnUS['network.family.zhixing'], 'Knowing-Doing Graph');
  assert.equal(messagesZhCN['network.family.zhixing'], '知行图');
});
