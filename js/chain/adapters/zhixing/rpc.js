// @ts-check
/**
 * 知行图(Knowing-Doing Graph)节点的只读查询。
 *
 * 节点 RPC 是 REST + JSON(不是以太坊 JSON-RPC):GET /info、/members、/account/{id}……
 * 统一带 `Accept: application/json`。所有 u64 都是带引号的十进制字符串(无损)。
 *
 * 钱包只用它显示"我是谁、在链上是什么状态":公钥 → 账户编号 → 是否已过见习期。
 * 知行图没有余额与转账,这里也不提供。
 */

export const ZHIXING_DEFAULT_RPC = 'https://blockchain.yeying.pub/rpc';
const TIMEOUT_MS = 10000;

/**
 * @param {string} rpcUrl
 * @param {string} path 以 / 开头
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
async function getJson(rpcUrl, path, opts = {}) {
  const base = String(rpcUrl || ZHIXING_DEFAULT_RPC).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await doFetch(base + path, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`ZHIXING_RPC_HTTP_${r.status}: ${path}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 链身份与高度:{ genesisHash, height, head } */
export async function getZhixingChainInfo(rpcUrl, opts) {
  const d = await getJson(rpcUrl, '/info', opts);
  if (!d) throw new Error('ZHIXING_RPC_NO_INFO');
  return { genesisHash: String(d.genesis_hash || ''), height: String(d.height || '0'), head: String(d.head || '') };
}

/**
 * 公钥 → 成员状态。
 * 节点按账户编号索引,没有按公钥的查询;成员很少(邀请制),逐个比对即可。
 * @returns {Promise<{ member: false } | { member: true, id: string, established: boolean, joinedHeight: string, nonce: string }>}
 */
export async function findZhixingMember(rpcUrl, pubkey, opts) {
  const want = String(pubkey || '').toLowerCase();
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const list = await getJson(rpcUrl, `/members?limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, opts);
    const items = (list && list.items) || [];
    for (const m of items) {
      const acct = await getJson(rpcUrl, '/account/' + encodeURIComponent(m.id), opts);
      if (acct && String(acct.pubkey || '').toLowerCase() === want) {
        return {
          member: true,
          id: String(m.id),
          established: !!m.established,
          joinedHeight: String(m.joined_height || '0'),
          nonce: String(acct.nonce || '0')
        };
      }
    }
    if (!list || !list.cursor || items.length === 0 || String(list.cursor) === cursor) break;
    cursor = String(list.cursor);
  }
  return { member: false };
}
