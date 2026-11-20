/**
 * 账户能用哪些网络。
 *
 * 首页先选账户,通证 / 藏品 / 活动三个页签里的网络菜单只列这个账户能用的网络:
 *   - 以太坊系账户(EVM):同一个地址在所有 EVM 网络上通用 → 列出全部 EVM 网络(含自定义);
 *   - 比特币账户:地址里编码了网络(主网 bc1… / 测试网 tb1…)→ 只列账户所在的那个网络;
 *   - 波场 / 索拉纳 / 知行图账户:主网与测试网地址相同 → 列出同一条链的全部网络。
 * 没有选中账户时不过滤。纯函数,popup 与 background 共用。
 */

const ADDRESS_BOUND_TO_NETWORK = new Set(['bip122']);

function namespaceOfKey(chainKey) {
  const key = String(chainKey || '').trim();
  const idx = key.indexOf(':');
  return idx > 0 ? key.slice(0, idx) : '';
}

/** 链族:'eip155' | 'tron' | 'solana' | 'bip122' | 'zhixing' | …(utxo 视同 bip122)。 */
export function chainFamily(namespace) {
  const ns = String(namespace || 'eip155').toLowerCase();
  return ns === 'utxo' ? 'bip122' : ns;
}

export function accountFamily(account) {
  return chainFamily(account?.namespace || namespaceOfKey(account?.chainKey) || 'eip155');
}

export function networkFamily(network) {
  return chainFamily(namespaceOfKey(network?.chainKey) || 'eip155');
}

/** 这个账户的地址能不能在这个网络上用。 */
export function isNetworkUsableByAccount(account, network) {
  if (!network) return false;
  if (!account) return true;
  const family = accountFamily(account);
  if (networkFamily(network) !== family) return false;
  if (ADDRESS_BOUND_TO_NETWORK.has(family) && account.chainKey && network.chainKey) {
    return account.chainKey === network.chainKey;
  }
  return true;
}

/** 过滤出账户能用的网络(保持原顺序)。 */
export function networksForAccount(account, networks) {
  const list = Array.isArray(networks) ? networks : Object.values(networks || {});
  return list.filter((network) => isNetworkUsableByAccount(account, network));
}
