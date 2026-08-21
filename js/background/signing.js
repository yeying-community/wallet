/**
 * YeYing Wallet - 签名操作
 * 负责：交易签名、消息签名、类型化数据签名
 */

import { getWalletInstance } from './keyring.js';
import { state } from './state.js';
import {
  getMpcKeyShares,
  getMpcWallet,
  getMpcWalletList,
  getNetworkByChainId,
  getNetworkConfigByKey,
  saveMpcSignRequest
} from '../storage/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { signMpcMessage, signMpcTransaction, signMpcTypedData } from './mpc-tss-engine.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { generateId } from '../common/utils/index.js';

export const MPC_ACCOUNT_ID_PREFIX = 'mpc:';

export function getMpcAccountId(walletId) {
  const id = String(walletId || '').trim();
  return id ? `${MPC_ACCOUNT_ID_PREFIX}${id}` : '';
}

export function isMpcAccountId(accountId) {
  return String(accountId || '').startsWith(MPC_ACCOUNT_ID_PREFIX);
}

function getMpcWalletIdFromAccountId(accountId) {
  return String(accountId || '').slice(MPC_ACCOUNT_ID_PREFIX.length).trim();
}

function normalizeAddress(value) {
  const address = String(value || '').trim();
  return ethers.isAddress(address) ? ethers.getAddress(address).toLowerCase() : '';
}

function ensureMpcWalletCanSign(wallet) {
  if (!wallet?.id) {
    throw new Error('MPC_WALLET_NOT_FOUND');
  }
  if (String(wallet.status || '').trim() !== 'active' || !normalizeAddress(wallet.address)) {
    throw new Error('MPC_KEYGEN_NOT_COMPLETED');
  }
  return wallet;
}

export async function resolveMpcAccountIdByAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  const wallets = await getMpcWalletList();
  const wallet = wallets.find((item) =>
    String(item?.status || '').trim() === 'active'
    && normalizeAddress(item?.address) === normalized
  );
  return wallet?.id ? getMpcAccountId(wallet.id) : '';
}

async function getMpcWalletForSigning(accountId) {
  const walletId = getMpcWalletIdFromAccountId(accountId);
  return walletId ? await getMpcWallet(walletId) : null;
}

async function getLatestMpcKeyShare(walletId) {
  const id = String(walletId || '').trim();
  if (!id) return null;
  const shares = Object.values(await getMpcKeyShares());
  const matches = shares
    .filter((share) => String(share?.walletId || '').trim() === id)
    .sort((a, b) => Number(b?.shareVersion || 0) - Number(a?.shareVersion || 0));
  return matches[0] || null;
}

async function createMpcSignContext(wallet, kind, payload) {
  const keyShare = await getLatestMpcKeyShare(wallet.id);
  if (!keyShare?.share) {
    throw new Error('MPC_KEY_SHARE_NOT_FOUND');
  }
  const now = getTimestamp();
  const request = {
    id: generateId('mpc_sign'),
    walletId: wallet.id,
    type: kind,
    status: 'pending',
    payload,
    keyVersion: Number(wallet.keyVersion || keyShare.keyVersion || 1),
    shareVersion: Number(keyShare.shareVersion || wallet.shareVersion || 1),
    chainId: state.currentChainId || '',
    createdAt: now,
    updatedAt: now
  };
  await saveMpcSignRequest(request);
  return { keyShare, request };
}

/**
 * 签名交易
 * @param {string} accountId - 账户 ID
 * @param {Object} transaction - 交易对象
 * @returns {Promise<Object>} 交易哈希和详情
 */
export async function signTransaction(accountId, transaction) {
  try {
    if (isMpcAccountId(accountId)) {
      const wallet = ensureMpcWalletCanSign(await getMpcWalletForSigning(accountId));
      const context = await createMpcSignContext(wallet, 'transaction', { transaction });
      return await signMpcTransaction({
        wallet,
        transaction,
        chainId: state.currentChainId,
        keyShare: context.keyShare,
        request: context.request
      });
    }
    const wallet = getWalletInstance(accountId);
    const normalizedTx = normalizeTransaction(transaction);

    // 连接到 provider
    const network = await getNetworkByChainId(state.currentChainId);
    let rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc;
    if (!rpcUrl) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
    }
    if (!rpcUrl) {
      throw new Error('RPC URL not configured');
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const connectedWallet = wallet.connect(provider);

    // 签名并发送交易
    const tx = await connectedWallet.sendTransaction(normalizedTx);

    console.log('✅ Transaction signed:', tx.hash);

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value?.toString(),
      nonce: tx.nonce,
      gasLimit: tx.gasLimit?.toString(),
      gasPrice: tx.gasPrice?.toString()
    };

  } catch (error) {
    console.error('❌ Sign transaction failed:', error);
    throw error;
  }
}

function normalizeTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object') return transaction;
  const tx = { ...transaction };

  if (typeof tx.to === 'string') {
    const trimmed = tx.to.trim();
    if (trimmed) {
      if (!ethers.isAddress(trimmed)) {
        throw new Error('Invalid "to" address');
      }
      tx.to = ethers.getAddress(trimmed);
    } else {
      delete tx.to;
    }
  }

  if (typeof tx.from === 'string') {
    const trimmed = tx.from.trim();
    if (!ethers.isAddress(trimmed)) {
      throw new Error('Invalid "from" address');
    }
  }

  if ('from' in tx) {
    delete tx.from;
  }

  if (tx.gas && !tx.gasLimit) {
    tx.gasLimit = tx.gas;
  }

  if ('gas' in tx) {
    delete tx.gas;
  }

  return tx;
}

/**
 * 签名消息
 * @param {string} accountId - 账户 ID
 * @param {string} message - 要签名的消息
 * @returns {Promise<string>} 签名
 */
export async function signMessage(accountId, message) {
  try {
    if (isMpcAccountId(accountId)) {
      const wallet = ensureMpcWalletCanSign(await getMpcWalletForSigning(accountId));
      const context = await createMpcSignContext(wallet, 'message', { message });
      return await signMpcMessage({
        wallet,
        message,
        chainId: state.currentChainId,
        keyShare: context.keyShare,
        request: context.request
      });
    }
    const wallet = getWalletInstance(accountId);
    const signature = await wallet.signMessage(message);

    console.log('✅ Message signed');

    return signature;

  } catch (error) {
    console.error('❌ Sign message failed:', error);
    throw error;
  }
}

/**
 * 签名类型化数据
 * @param {string} accountId - 账户 ID
 * @param {Object} domain - 域
 * @param {Object} types - 类型
 * @param {Object} value - 值
 * @returns {Promise<string>} 签名
 */
export async function signTypedData(accountId, domain, types, value) {
  try {
    if (isMpcAccountId(accountId)) {
      const wallet = ensureMpcWalletCanSign(await getMpcWalletForSigning(accountId));
      const context = await createMpcSignContext(wallet, 'typed_data', { domain, types, value });
      return await signMpcTypedData({
        wallet,
        domain,
        types,
        value,
        chainId: state.currentChainId,
        keyShare: context.keyShare,
        request: context.request
      });
    }
    const wallet = getWalletInstance(accountId);
    const normalized = normalizeTypedData(domain, types, value);
    const signature = await wallet.signTypedData(
      normalized.domain,
      normalized.types,
      normalized.value
    );

    console.log('✅ Typed data signed');

    return signature;

  } catch (error) {
    console.error('❌ Sign typed data failed:', error);
    throw error;
  }
}

function normalizeTypedData(domain, types, value) {
  const normalizedDomain = { ...(domain || {}) };
  if (normalizedDomain.chainId) {
    if (typeof normalizedDomain.chainId === 'string') {
      const parsed = normalizedDomain.chainId.startsWith('0x')
        ? parseInt(normalizedDomain.chainId, 16)
        : parseInt(normalizedDomain.chainId, 10);
      if (!Number.isNaN(parsed)) {
        normalizedDomain.chainId = parsed;
      }
    }
  }

  const normalizedTypes = { ...(types || {}) };
  if (normalizedTypes.EIP712Domain) {
    delete normalizedTypes.EIP712Domain;
  }

  return {
    domain: normalizedDomain,
    types: normalizedTypes,
    value: value || {}
  };
}
