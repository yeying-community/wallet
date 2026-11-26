// @ts-check
/**
 * 知行图(KnowDoGraph):账户查找、站点授权、签署知识操作、链上状态。
 *
 * 知行图账户是**普通的钱包账户**(namespace=zhixing),在「账户管理 → 导入钱包」里按链导入:
 * 助记词、64 位十六进制种子、或 `node keygen --encrypt` 的加密密钥文件。派生与知行图
 * `node keygen` 完全相同,所以导入同一把密钥就是同一个链上账户。
 *
 * 与其它链的差别只有两处:
 *   - 没有余额、没有转账、没有通证:账户只用于签署知识操作;
 *   - 一把种子对应一个账户(没有 BIP-32 路径),所以不能派生子账户,也不参与按助记词
 *     重新派生的 HD 备份同步(钱包类型是 IMPORTED)。
 */

import { getMap, getMapItem, setMapItem, deleteMapItem } from '../../storage/storage-base.js';
import { ZhixingStorageKeys } from '../../storage/storage-keys.js';
import { state } from '../state.js';
import { getCachedPassword, refreshPasswordCache } from '../password-cache.js';
import { decryptString } from '../../common/crypto/encryption.js';
import { zhixingKeypairFromSeed } from '../../chain/adapters/zhixing/keys.js';
import { getAccountList, getSelectedAccount } from '../../storage/account-storage.js';
import {
  signKnowledgeOp,
  describeKnowledgeOp,
  encodeKnowledgeOp,
  bytesToHex
} from '../../chain/adapters/zhixing/op.js';
import { ZHIXING_DEFAULT_RPC, getZhixingChainInfo, findZhixingMember } from '../../chain/adapters/zhixing/rpc.js';

// ---- 账户 ---------------------------------------------------------------------

/**
 * 用于知行图的账户:当前选中的若是知行图账户就用它,否则用钱包里第一个知行图账户。
 * (组织者可能把几位成员的密钥都导进同一个钱包:切换选中账户即切换身份。)
 */
export async function getZhixingAccount() {
  const selected = await getSelectedAccount();
  if (selected && selected.namespace === 'zhixing') return selected;
  const accounts = await getAccountList();
  return (accounts || []).find((a) => a?.namespace === 'zhixing') || null;
}

/** 公开信息(不含私钥)。 */
export async function getZhixingKeyInfo() {
  const account = await getZhixingAccount();
  if (!account) return null;
  return { address: String(account.address || '').toLowerCase(), accountId: account.id, name: account.name || '' };
}

/** 是否需要先解锁钱包(内存里没有该账户的密钥,也没有缓存的钱包密码)。 */
export async function needsZhixingUnlock() {
  const account = await getZhixingAccount();
  if (!account) return false;
  return !(state.ed25519Keyring && state.ed25519Keyring.has(account.id)) && !getCachedPassword();
}

/** 取该知行图账户的 ed25519 KeyPair:已解锁就用缓存,否则用缓存的钱包密码解密私钥字段(即种子)。 */
export async function loadZhixingKeypair() {
  const account = await getZhixingAccount();
  if (!account) throw new Error('ZHIXING_NO_KEY: 钱包里还没有知行图账户');
  const cached = state.ed25519Keyring && state.ed25519Keyring.get(account.id);
  if (cached) return { account, keypair: cached };
  const password = getCachedPassword();
  if (!password) throw new Error('ZHIXING_LOCKED: 钱包已锁定,请先解锁');
  const seedHex = await decryptString(account.encryptedPrivateKey, password);
  const keypair = zhixingKeypairFromSeed(seedHex);
  if (bytesToHex(keypair.publicKey) !== String(account.address).toLowerCase()) {
    throw new Error('ZHIXING_KEY_CORRUPT: 私钥与账户地址不一致');
  }
  if (!state.ed25519Keyring) state.ed25519Keyring = new Map();
  state.ed25519Keyring.set(account.id, keypair);
  return { account, keypair };
}

// ---- 站点授权 -------------------------------------------------------------------

export async function isZhixingSiteAuthorized(origin) {
  const info = await getZhixingKeyInfo();
  if (!info) return false;
  const site = await getMapItem(ZhixingStorageKeys.SITES, origin);
  return !!site && site.address === info.address;
}

export async function grantZhixingSite(origin) {
  const info = await getZhixingKeyInfo();
  if (!info) throw new Error('ZHIXING_NO_KEY: 钱包里还没有知行图账户');
  await setMapItem(ZhixingStorageKeys.SITES, origin, { address: info.address, grantedAt: Date.now() });
  return info;
}

/** @param {{ origin?: string }} [args] */
export async function revokeZhixingSite({ origin } = {}) {
  await deleteMapItem(ZhixingStorageKeys.SITES, String(origin || ''));
  return { revoked: true };
}

export async function listZhixingSites() {
  const map = await getMap(ZhixingStorageKeys.SITES);
  return Object.entries(map || {}).map(([origin, v]) => ({ origin, ...v }));
}

// ---- 签名请求 -------------------------------------------------------------------

/**
 * 校验网页递来的签名请求,产出审批弹窗要显示的内容。
 * 网页只给"意图":{ actor, nonce, action };钱包自己编码,网页没法塞别的字节。
 */
export function prepareZhixingSignRequest(params) {
  const req = Array.isArray(params) ? params[0] : params;
  if (!req || typeof req !== 'object') throw new Error('ZHIXING_BAD_REQUEST');
  const { actor, nonce, action } = req;
  encodeKnowledgeOp(actor, action, nonce); // 不合法就在弹窗前抛错
  const summary = describeKnowledgeOp(actor, action, nonce);
  return { actor: String(actor), nonce: String(nonce), action, summary };
}

/** 用户批准后签名;返回可直接 POST 到节点 /knowledge 的十六进制(op ‖ 签名)。 */
export async function signZhixingRequest(prepared) {
  const { keypair } = await loadZhixingKeypair();
  refreshPasswordCache();
  const signed = signKnowledgeOp(keypair, prepared.actor, prepared.action, prepared.nonce);
  return { signed: bytesToHex(signed), address: bytesToHex(keypair.publicKey) };
}

// ---- 首页状态(选中知行图网络时显示)----------------------------------------------

const STATUS_TTL_MS = 30000;
let statusCache = { key: '', at: 0, value: null };

/**
 * 知行图成员状态:公钥 → 是否是成员、账户编号、是否已过见习期;以及链高度。
 * 成员查询要逐个比对账户,缓存 30 秒,避免首页每次刷新都扫一遍。
 * @param {{ rpcUrl?: string, force?: boolean }} [args]
 */
export async function getZhixingStatus({ rpcUrl, force = false } = {}) {
  const info = await getZhixingKeyInfo();
  const rpc = rpcUrl || ZHIXING_DEFAULT_RPC;
  const cacheKey = `${rpc}|${info ? info.address : ''}`;
  if (!force && statusCache.key === cacheKey && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }
  let chain = null;
  let member = { member: false };
  let error = '';
  try {
    chain = await getZhixingChainInfo(rpc);
    if (info) member = await findZhixingMember(rpc, info.address);
  } catch (e) {
    error = String(e?.message || e);
  }
  const value = {
    hasKey: !!info,
    address: info ? info.address : '',
    accountId: info ? info.accountId : '',
    height: chain ? chain.height : '',
    explorer: rpc.replace(/\/rpc\/?$/, ''),
    ...member,
    error
  };
  if (!error) statusCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
