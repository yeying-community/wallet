/**
 * 网络显示名:按界面语言(中文 / English)取。
 *
 * 内置网络的中英文名在 network-config.js 的 `names` 里;这里在**显示时**从配置取名,而不是用存储里那份网络副本的
 * `name`——副本在首次安装时写入、之后不会刷新,直接用它的话,改名或切换语言都到不了已安装的钱包。
 * 用户或 DApp 添加的网络用它们自己的名字(chainName / name),不翻译。
 */
import { NETWORKS } from './network-config.js';
import { getLocale, t } from '../common/i18n/index.js';

const BUILTIN_BY_ID = new Map();
const BUILTIN_BY_CHAIN_KEY = new Map();
for (const [key, network] of Object.entries(NETWORKS)) {
  BUILTIN_BY_ID.set(key, network);
  if (network.id) BUILTIN_BY_ID.set(network.id, network);
  // 非 EVM 网络按 chainKey 唯一;EVM 网络可能被用户以同一 chainId 自定义,不按 chainId 认内置
  if (network.chainKey && !network.chainId) BUILTIN_BY_CHAIN_KEY.set(network.chainKey, network);
}

/** 找到对应的内置网络配置;自定义网络返回 null。 */
export function findBuiltinNetwork(network) {
  if (!network) return null;
  if (typeof network === 'string') return BUILTIN_BY_ID.get(network) || BUILTIN_BY_CHAIN_KEY.get(network) || null;
  if (network.chainName) return null; // 自定义网络(用户 / DApp 添加)用 chainName
  return BUILTIN_BY_ID.get(network.key) || BUILTIN_BY_ID.get(network.id)
    || (network.chainKey ? BUILTIN_BY_CHAIN_KEY.get(network.chainKey) : null) || null;
}

/** 内置网络在指定语言下的名字。 */
export function builtinNetworkName(builtin, locale = getLocale()) {
  return builtin?.names?.[locale] || builtin?.names?.['en-US'] || builtin?.name || '';
}

/**
 * 网络的显示名。
 * @param {object|string|null} network 存储里的网络对象,或网络 key / chainKey
 * @param {string} [fallback] 找不到名字时显示的文字(默认"网络 / Network")
 */
export function getNetworkDisplayName(network, fallback) {
  const builtin = findBuiltinNetwork(network);
  if (builtin) return builtinNetworkName(builtin);
  if (network && typeof network === 'object') {
    const own = network.chainName || network.name;
    if (own) return own;
  }
  return fallback ?? t('network.generic');
}
