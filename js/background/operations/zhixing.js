// @ts-check
/**
 * 知行图(ZhixingGraph)成员密钥:保存、解锁、站点授权、签署知识操作。
 *
 * 为什么不是一个"链账户"(像 Solana 那样):
 *   知行图没有余额、没有转账,地址是 64 位十六进制 ed25519 公钥。放进 accounts 会被备份同步按 EVM
 *   地址校验整包拒收、被 eth_accounts 当成 0x 地址交给 EVM 网站。所以它像"钱包身份控制密钥"一样,
 *   单独保存、用钱包密码加密、不进 accounts 与备份同步。
 *
 * 一个钱包只保存一把知行图密钥(与 `node keygen` 一致:一组助记词对应一个知行图账户)。
 *
 * 内存:解锁后把 nacl KeyPair 缓存在 state.zhixingKeypair,钱包锁定时清除(lockWallet)。
 */

import { encryptString, decryptString } from '../../common/crypto/encryption.js';
import { getValue, setValue, removeStorage, getMap, getMapItem, setMapItem, deleteMapItem } from '../../storage/storage-base.js';
import { ZhixingStorageKeys } from '../../storage/storage-keys.js';
import { state } from '../state.js';
import { getCachedPassword, refreshPasswordCache } from '../password-cache.js';
import {
  zhixingSeedFromMnemonic,
  zhixingKeypairFromSeed,
  zhixingAddressFromSeed
} from '../../chain/adapters/zhixing/keys.js';
import {
  signKnowledgeOp,
  describeKnowledgeOp,
  encodeKnowledgeOp,
  bytesToHex
} from '../../chain/adapters/zhixing/op.js';
import { ethers } from '../../../lib/ethers-6.16.esm.min.js';
import { ZHIXING_DEFAULT_RPC, getZhixingChainInfo, findZhixingMember } from '../../chain/adapters/zhixing/rpc.js';

function requirePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('ZHIXING_PASSWORD_REQUIRED');
  }
}

// ---- 存储 ---------------------------------------------------------------------

/** 公开信息(不含加密种子)。 */
export async function getZhixingKeyInfo() {
  const record = await getValue(ZhixingStorageKeys.KEY, null);
  if (!record || !record.address) return null;
  return { address: record.address, source: record.source || 'mnemonic', createdAt: record.createdAt || 0 };
}

async function saveSeed(seedHex, password, source) {
  const address = zhixingAddressFromSeed(seedHex);
  const encryptedSeed = await encryptString(seedHex, password);
  await setValue(ZhixingStorageKeys.KEY, { address, encryptedSeed, source, createdAt: Date.now() });
  state.zhixingKeypair = zhixingKeypairFromSeed(seedHex);
  return { address, source };
}

/**
 * 生成新密钥:返回 24 个词(只在这一次给用户看)。
 * 与知行图浏览器「生成新身份」、`node keygen --new-mnemonic` 相同:32 字节熵 → 24 词。
 */
/** @param {{ password?: string }} [args] */
export async function handleCreateZhixingKey({ password } = {}) {
  requirePassword(password);
  if (await getZhixingKeyInfo()) throw new Error('ZHIXING_KEY_EXISTS');
  const entropy = new Uint8Array(32);
  globalThis.crypto.getRandomValues(entropy);
  const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;
  entropy.fill(0);
  const info = await saveSeed(zhixingSeedFromMnemonic(mnemonic), password, 'generated');
  return { ...info, mnemonic };
}

/** 用助记词导入(与知行图既有成员身份完全相同的派生)。 */
/** @param {{ mnemonic?: string, passphrase?: string, password?: string }} [args] */
export async function handleImportZhixingKey({ mnemonic, passphrase = '', password } = {}) {
  requirePassword(password);
  if (await getZhixingKeyInfo()) throw new Error('ZHIXING_KEY_EXISTS');
  let seedHex;
  try {
    seedHex = zhixingSeedFromMnemonic(String(mnemonic || ''), String(passphrase || ''));
  } catch (_) {
    throw new Error('ZHIXING_BAD_MNEMONIC');
  }
  return saveSeed(seedHex, password, 'mnemonic');
}

/** 移除:需要密码确认(防止误删;没有助记词就永久找不回)。 */
/** @param {{ password?: string }} [args] */
export async function handleRemoveZhixingKey({ password } = {}) {
  requirePassword(password);
  const record = await getValue(ZhixingStorageKeys.KEY, null);
  if (!record) return { removed: false };
  await decryptString(record.encryptedSeed, password); // 密码不对会抛错
  await removeStorage([ZhixingStorageKeys.KEY, ZhixingStorageKeys.SITES]);
  state.zhixingKeypair = null;
  return { removed: true };
}

/**
 * 修改钱包密码时一并重加密(由 changePassword 在同一次原子写入里带上)。
 * @returns {Promise<Record<string, any>>} 要写入的存储项;没有密钥时为空对象
 */
export async function reencryptZhixingKey(oldPassword, newPassword) {
  const record = await getValue(ZhixingStorageKeys.KEY, null);
  if (!record || !record.encryptedSeed) return {};
  const seedHex = await decryptString(record.encryptedSeed, oldPassword);
  return { [ZhixingStorageKeys.KEY]: { ...record, encryptedSeed: await encryptString(seedHex, newPassword) } };
}

/** 解锁(用缓存的钱包密码);已在内存则直接返回。 */
export async function loadZhixingKeypair(password = getCachedPassword()) {
  if (state.zhixingKeypair) return state.zhixingKeypair;
  const record = await getValue(ZhixingStorageKeys.KEY, null);
  if (!record) throw new Error('ZHIXING_NO_KEY');
  if (!password) throw new Error('ZHIXING_LOCKED');
  const seedHex = await decryptString(record.encryptedSeed, password);
  const kp = zhixingKeypairFromSeed(seedHex);
  if (bytesToHex(kp.publicKey) !== record.address) throw new Error('ZHIXING_KEY_CORRUPT');
  state.zhixingKeypair = kp;
  return kp;
}

export function needsZhixingUnlock() {
  return !state.zhixingKeypair && !getCachedPassword();
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
  if (!info) throw new Error('ZHIXING_NO_KEY');
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
  const kp = await loadZhixingKeypair();
  refreshPasswordCache();
  const signed = signKnowledgeOp(kp, prepared.actor, prepared.action, prepared.nonce);
  return { signed: bytesToHex(signed), address: bytesToHex(kp.publicKey) };
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
    height: chain ? chain.height : '',
    explorer: rpc.replace(/\/rpc\/?$/, ''),
    ...member,
    error
  };
  if (!error) statusCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
