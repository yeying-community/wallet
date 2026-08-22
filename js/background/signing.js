/**
 * YeYing Wallet - 签名操作
 * 负责：交易签名、消息签名、类型化数据签名
 */

import { getWalletInstance } from './keyring.js';
import { state } from './state.js';
import {
  getMpcKeyShares,
  getMpcSignRequest,
  getMpcWallet,
  getMpcWalletList,
  getSelectedAccount,
  getNetworkByChainId,
  getNetworkConfigByKey,
  getUserSetting,
  saveMpcSignRequest
} from '../storage/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { mpcService } from './mpc-service.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { generateId } from '../common/utils/index.js';
import { buildActionPayloadHash, createActionSignature } from './action-signature.js';
import { MpcCoordinatorClient } from './mpc-coordinator-client.js';

export const MPC_ACCOUNT_ID_PREFIX = 'mpc:';
const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://node.yeying.pub';

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

function normalizeMpcSigningPayload(kind, payload) {
  if (kind === 'message') {
    return {
      ...payload,
      messageHex: ethers.hexlify(ethers.toUtf8Bytes(String(payload?.message ?? '')))
    };
  }
  if (kind === 'transaction') {
    const normalized = normalizeTransaction(payload?.transaction || {});
    const unsignedTx = ethers.Transaction.from(normalized);
    return {
      ...payload,
      transaction: normalized,
      unsignedTransaction: unsignedTx.unsignedSerialized,
      transactionHash: unsignedTx.unsignedHash,
      messageHex: unsignedTx.unsignedHash
    };
  }
  if (kind === 'typed_data') {
    const normalized = normalizeTypedData(payload?.domain, payload?.types, payload?.value);
    const typedDataHash = ethers.TypedDataEncoder.hash(
      normalized.domain,
      normalized.types,
      normalized.value
    );
    return {
      ...normalized,
      typedDataHash,
      messageHex: typedDataHash
    };
  }
  return payload;
}

function getMpcParticipantIndex(keyShare) {
  const index = Number(keyShare?.participantIndex);
  if (Number.isInteger(index) && index >= 0) return index;
  const shareIndex = Number(keyShare?.share?.i ?? keyShare?.share?.participant_index);
  if (Number.isInteger(shareIndex) && shareIndex > 0) {
    return shareIndex - 1;
  }
  return 0;
}

function getMpcParties(wallet) {
  const participants = Array.isArray(wallet?.participants) ? wallet.participants : [];
  return participants.length ? participants.map((_participant, index) => index) : [0, 1];
}

async function createMpcSignContext(wallet, kind, payload) {
  const keyShare = await getLatestMpcKeyShare(wallet.id);
  if (!keyShare?.share) {
    throw new Error('MPC_KEY_SHARE_NOT_FOUND');
  }
  if (!keyShare.completeKeyShare) {
    throw new Error('MPC_COMPLETE_KEY_SHARE_NOT_FOUND');
  }
  const signingPayload = normalizeMpcSigningPayload(kind, payload);
  const now = getTimestamp();
  const request = {
    id: generateId('mpc_sign'),
    walletId: wallet.id,
    sessionId: String(wallet.keygenSessionId || '').trim(),
    type: kind,
    status: 'pending',
    payload: signingPayload,
    keyVersion: Number(wallet.keyVersion || keyShare.keyVersion || 1),
    shareVersion: Number(keyShare.shareVersion || wallet.shareVersion || 1),
    chainId: state.currentChainId || '',
    createdAt: now,
    updatedAt: now
  };
  await saveMpcSignRequest(request);
  const remoteRequest = await syncMpcSignRequest(wallet, request).catch(() => null);
  if (remoteRequest && typeof remoteRequest === 'object') {
    const mergedRequest = {
      ...request,
      ...remoteRequest,
      id: request.id,
      remoteId: remoteRequest.id && remoteRequest.id !== request.id ? remoteRequest.id : request.remoteId,
      type: request.type,
      payload: remoteRequest.payload || request.payload,
      updatedAt: getTimestamp()
    };
    await saveMpcSignRequest(mergedRequest);
    return { keyShare, request: mergedRequest };
  }
  return { keyShare, request };
}

async function syncMpcSignRequest(wallet, request) {
  const token = String(await getUserSetting('mpcCoordinatorUcanToken', '') || '').trim();
  if (!token) return null;
  const endpoint = String(await getUserSetting('mpcCoordinatorEndpoint', DEFAULT_MPC_COORDINATOR_ENDPOINT) || '').trim();
  const sessionId = String(wallet?.keygenSessionId || '').trim();
  if (!endpoint || !sessionId) return null;
  const chainId = Number(request.chainId || 0);
  const payloadHash = await buildActionPayloadHash(request.payload ?? null);
  const payload = {
    requestId: request.id,
    signRequestId: request.id,
    walletId: wallet.id,
    sessionId,
    payloadType: request.type,
    payloadHash,
    payload: request.payload ?? {},
    chainId: Number.isFinite(chainId) ? chainId : 0
  };
  const signature = await createActionSignature({
    account: await getSelectedAccount(),
    action: 'mpc_sign_request_create',
    payload
  });
  const client = new MpcCoordinatorClient({
    endpoint,
    getToken: async () => token
  });
  return await client.createSignRequest(payload, signature);
}

function createPendingMpcSignError(request) {
  const error = new Error('MPC_SIGNING_PENDING');
  error.code = 'MPC_SIGNING_PENDING';
  error.requestId = request?.id || '';
  error.signRequest = request || null;
  return error;
}

function extractMpcSignature(source) {
  return String(
    source?.signRequest?.signature
    || (typeof source?.signature === 'string' ? source.signature : '')
    || source?.signatureHex
    || (typeof source?.result?.signature === 'string' ? source.result.signature : '')
    || (typeof source?.result?.signatureHex === 'string' ? source.result.signatureHex : '')
    || ''
  ).trim();
}

function normalizeMpcSignatureParts(source) {
  const result = source?.signRequest?.result || source?.result || source || {};
  const signature = result?.signature && typeof result.signature === 'object'
    ? result.signature
    : (source?.signature && typeof source.signature === 'object' ? source.signature : null);
  const signatureHex = String(
    source?.signRequest?.signatureHex
    || source?.signRequest?.signature
    || source?.signatureHex
    || (typeof source?.signature === 'string' ? source.signature : '')
    || result?.signatureHex
    || (typeof result?.signature === 'string' ? result.signature : '')
    || ''
  ).trim();
  if (signatureHex && /^0x[0-9a-fA-F]{130}$/.test(signatureHex)) {
    return ethers.Signature.from(signatureHex);
  }
  const r = String(signature?.r || result?.r || '').trim();
  const s = String(signature?.s || result?.s || '').trim();
  if (!r || !s) {
    return null;
  }
  const recovery = signature?.recoveryId ?? signature?.recid ?? signature?.v ?? result?.recoveryId ?? result?.recid ?? result?.v;
  const recoveryNumber = Number(recovery);
  const v = Number.isInteger(recoveryNumber)
    ? (recoveryNumber >= 27 ? recoveryNumber : recoveryNumber + 27)
    : 27;
  return ethers.Signature.from({ r, s, v });
}

function buildMpcSignedTransaction(context, signatureSource) {
  const txPayload = context?.request?.payload || {};
  if (context?.request?.type !== 'transaction' && !txPayload.transaction) {
    return '';
  }
  const signature = normalizeMpcSignatureParts(signatureSource);
  if (!signature) {
    return '';
  }
  const tx = ethers.Transaction.from(txPayload.transaction || {});
  tx.signature = signature;
  return tx.serialized;
}

async function startMpcWireSigning(wallet, context) {
  const sessionId = String(context.request?.sessionId || wallet.keygenSessionId || '').trim();
  if (!sessionId) {
    throw new Error('MPC_SESSION_NOT_FOUND');
  }
  const participantIndex = getMpcParticipantIndex(context.keyShare);
  try {
    await mpcService.startWireSession({
      sessionId,
      protocol: 'sign',
      requestId: context.request.id,
      recipientIndex: participantIndex,
      parties: getMpcParties(wallet),
      payload: context.request.payload,
      keyShareRef: context.keyShare
    });
    const maxTicks = 5;
    for (let attempt = 0; attempt < maxTicks; attempt += 1) {
      const tick = await mpcService.tickWireSession({
        sessionId,
        protocol: 'sign',
        requestId: context.request.id,
        participantId: context.keyShare.participantId,
        recipientIndex: participantIndex
      });
      if (context.request?.type === 'transaction') {
        const completedRequest = await getMpcSignRequest(context.request.id);
        const signedTransaction = buildMpcSignedTransaction(context, tick?.handledResult)
          || buildMpcSignedTransaction(context, tick?.result)
          || buildMpcSignedTransaction(context, completedRequest);
        if (signedTransaction) {
          return signedTransaction;
        }
      }
      const signature = extractMpcSignature(tick?.handledResult)
        || extractMpcSignature(tick?.result)
        || extractMpcSignature(await getMpcSignRequest(context.request.id));
      if (signature) {
        return signature;
      }
      const madeProgress = (tick?.messages?.length || 0) > 0 || (tick?.outputs?.length || 0) > 0;
      if (!madeProgress) {
        break;
      }
    }
    throw createPendingMpcSignError(context.request);
  } catch (error) {
    if (String(error?.message || error || '') === 'MPC_TSS_ENGINE_NOT_CONFIGURED') {
      throw new Error('MPC_SIGNER_NOT_CONFIGURED');
    }
    throw error;
  }
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
      return await startMpcWireSigning(wallet, context);
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
      return await startMpcWireSigning(wallet, context);
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
      return await startMpcWireSigning(wallet, context);
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
