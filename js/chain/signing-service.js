// @ts-check
/**
 * 签名服务（调用方唯一入口）
 *
 * 阶段 0 Step 4：统一本地私钥与 MPC 两条签名路径为
 *   “signTransactionRaw → rawTx → broadcastRawTransaction(adapter.broadcast)”，
 * 消除 signing.js（本地 sendTransaction 一步到位）与 request-router（MPC 外部
 * 广播）之间的分叉，并补齐 message-handler 路径 C 的 MPC 广播缺口。
 *
 * - 交易：本地走 ethers populateTransaction + signTransaction（复用 nonce/gas/
 *   EIP-1559-vs-legacy/chainId 填充，仅去掉 provider 广播这一步，字节等价于旧
 *   sendTransaction）；MPC 走 mpc-cggmp24 编排（返回已组装 rawTx，未完成抛
 *   MPC_SIGNING_PENDING）。两者都返回 rawTx，再由 broadcastRawTransaction 统一广播。
 * - 消息 / typed data：返回 sigHex，外部契约不变（本地走 ethers，MPC 走编排）。
 *
 * rawTx 广播统一走 registry → evmAdapter.broadcast（内部 eth_sendRawTransaction）。
 */

import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { getWalletInstance } from '../background/keyring.js';
import { isMpcAccountId, buildMpcSignedTransactionFromSignRequest } from '../background/signing.js';
import { normalizeTransaction } from './adapters/evm/transaction.js';
import { normalizeTypedData } from './adapters/evm/typed-data.js';
import { resolveEvmRpcUrl } from './adapters/evm/rpc.js';
import { getAdapter } from './registry.js';
import { getCurrentChainKey } from './current-chain.js';
import { mpcSignTransaction, mpcSignMessage, mpcSignTypedData } from './signers/mpc-cggmp24.js';

function isPendingMpcSignError(error) {
  return String(error?.code || error?.message || '').trim() === 'MPC_SIGNING_PENDING';
}

/**
 * 交易签名，返回 rawTx（不广播）。本地 + MPC 统一。
 * @param {string} chainKey CAIP-2，如 eip155:1
 * @param {string} accountId
 * @param {Object} transaction 原始交易对象（可为部分字段，本地路径会补全）
 * @returns {Promise<string>} rawTx（0x...）
 */
export async function signTransactionRaw(chainKey, accountId, transaction) {
  try {
    if (isMpcAccountId(accountId)) {
      return await mpcSignTransaction(accountId, transaction);
    }
    const wallet = getWalletInstance(accountId);
    const normalizedTx = normalizeTransaction(transaction);
    const rpcUrl = await resolveEvmRpcUrl(chainKey);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const connectedWallet = wallet.connect(provider);
    // populateTransaction 复用 ethers 的 nonce/gas/EIP-1559/chainId 填充逻辑；
    // 随后 signTransaction 出 rawTx，广播由 broadcastRawTransaction 统一负责。
    const populated = await connectedWallet.populateTransaction(normalizedTx);
    return await connectedWallet.signTransaction(populated);
  } catch (error) {
    if (!isPendingMpcSignError(error)) {
      console.error('❌ Sign transaction failed:', error);
    }
    throw error;
  }
}

/**
 * 广播 rawTx，返回交易哈希。统一走 evmAdapter.broadcast。
 * @param {string} chainKey
 * @param {string} rawTx
 * @returns {Promise<string>} txHash（0x + 64 hex）
 */
export async function broadcastRawTransaction(chainKey, rawTx) {
  return await getAdapter(chainKey).broadcast(rawTx, { chainKey });
}

/**
 * 由已完成的 MPC 签名请求组装 rawTx（供 request-router 等待收尾使用）。
 * @param {Object} signRequest
 * @returns {string} rawTx（0x...）或 ''
 */
export function assembleRawFromSignRequest(signRequest) {
  return buildMpcSignedTransactionFromSignRequest(signRequest);
}

/**
 * 消息签名（personal_sign / EIP-191）。返回 sigHex，外部契约不变。
 * @param {string} accountId
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function signMessage(accountId, message) {
  try {
    if (isMpcAccountId(accountId)) {
      return await mpcSignMessage(accountId, message);
    }
    const wallet = getWalletInstance(accountId);
    return await wallet.signMessage(message);
  } catch (error) {
    if (!isPendingMpcSignError(error)) {
      console.error('❌ Sign message failed:', error);
    }
    throw error;
  }
}

/**
 * 类型化数据签名（EIP-712）。返回 sigHex，外部契约不变。
 * @param {string} accountId
 * @param {Object} domain
 * @param {Object} types
 * @param {Object} value
 * @returns {Promise<string>}
 */
export async function signTypedData(accountId, domain, types, value) {
  try {
    if (isMpcAccountId(accountId)) {
      return await mpcSignTypedData(accountId, domain, types, value);
    }
    const wallet = getWalletInstance(accountId);
    const normalized = normalizeTypedData(domain, types, value);
    return await wallet.signTypedData(
      normalized.domain,
      normalized.types,
      normalized.value
    );
  } catch (error) {
    if (!isPendingMpcSignError(error)) {
      console.error('❌ Sign typed data failed:', error);
    }
    throw error;
  }
}

export { getCurrentChainKey };
