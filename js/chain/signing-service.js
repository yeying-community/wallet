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
 * rawTx 广播统一走 registry → adapter.broadcast（内部 eth_sendRawTransaction
 * 或 Tron /wallet/broadcasttransaction）。Tron 路径：signTransactionRaw 返回
 * 已附签名的 transaction JSON 串（满足 tronAdapter.broadcast 的 signedJson
 * 形态）。
 *
 * 阶段 1：Tron（`tron:*`）走本地 secp256k1 keyring：buildUnsigned → SHA-256
 * 摘要 → ECDSA 签名（v 归一化为 0/1）→ assembleSigned → broadcast JSON。
 * MPC 路径对 Tron 暂不支持，抛 UNSUPPORTED_OPERATION。
 */

import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { getWalletInstance } from '../background/keyring.js';
import { getAccountPrivateKey } from '../background/vault.js';
import { isMpcAccountId, buildMpcSignedTransactionFromSignRequest } from '../background/signing.js';
import { normalizeTransaction } from './adapters/evm/transaction.js';
import { normalizeTypedData } from './adapters/evm/typed-data.js';
import { resolveEvmRpcUrl } from './adapters/evm/rpc.js';
import { getAdapter, getSigner } from './registry.js';
import { getCurrentChainKey } from './current-chain.js';
import { namespaceOf } from './chain-key.js';
import { mpcSignTransaction, mpcSignMessage, mpcSignTypedData } from './signers/mpc-cggmp24.js';
import {
  buildUnsigned as buildTronUnsigned,
  assembleSigned as assembleTronSigned
} from './adapters/tron/transaction.js';
import {
  buildUnsigned as buildBitcoinUnsigned,
  assembleSigned as assembleBitcoinSigned
} from './adapters/bip122/transaction.js';
import { hexToBytes } from './adapters/bip122/address.js';

function isPendingMpcSignError(error) {
  return String(error?.code || error?.message || '').trim() === 'MPC_SIGNING_PENDING';
}

/**
 * 交易签名，返回 rawTx（不广播）。本地 + MPC 统一。
 * @param {string} chainKey CAIP-2，如 eip155:1 / tron:mainnet / solana:mainnet-beta
 * @param {string} accountId
 * @param {Object} transaction 原始交易对象（可为部分字段，本地路径会补全）
 * @returns {Promise<string>} rawTx（EVM: 0x...；Tron: 已附 signature 的 JSON 串；Solana: base58 wire）
 */
export async function signTransactionRaw(chainKey, accountId, transaction) {
  try {
    // Tron 分支：本路径只支持本地 keyring；MPC 路径 v1 暂不支持。
    if (namespaceOf(chainKey) === 'tron') {
      return await signTronTransactionLocal(chainKey, accountId, transaction);
    }

    // Solana 分支：ed25519 走 native SOL transfer（或 Phase 3 的 SPL token）。
    if (namespaceOf(chainKey) === 'solana') {
      return await signSolanaTransactionLocal(chainKey, accountId, transaction);
    }

    // Bitcoin 分支：secp256k1 UTXO，多 input 逐个签 BIP-143 sighash。
    if (namespaceOf(chainKey) === 'bip122') {
      return await signBitcoinTransactionLocal(chainKey, accountId, transaction);
    }

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
 * Tron 本地签名：buildUnsigned → SHA-256 摘要 → keyring 私钥 ECDSA → 归一化
 * v 0/1 → assembleSigned 返回 JSON 串（直接给 broadcastRawTransaction）。
 *
 * MPC 路径对 Tron 暂不支持（Tron MPC hook 在 v1 抛 UNSUPPORTED_OPERATION）。
 */
async function signTronTransactionLocal(chainKey, accountId, transaction) {
  if (isMpcAccountId(accountId)) {
    throw Object.assign(new Error('Tron MPC signing is not implemented in v1'), {
      code: 'UNSUPPORTED_OPERATION'
    });
  }

  // 取 keyring 里的 ethers.Wallet（解锁时 createWalletInstance 缓存的是
  // EVM 形态实例）；Tron 复用同一条 secp256k1 曲线，私钥字节等价。
  const wallet = getWalletInstance(accountId);
  const privateKeyHex = wallet.privateKey;

  // 1) 调 adapter 拿 digest（hashAlg='sha256'）+ serializeState（完整 transaction JSON）
  const unsigned = await buildTronUnsigned(transaction, { chainKey });

  // 2) ECDSA 签摘要：ethers.SigningKey.sign(digest) 接受任意 32 字节摘要；
  //    v=27/28 归一化为 0/1 在 assembleSigned 完成。
  const payload = unsigned.payloads[0];
  if (!payload || payload.kind !== 'digest') {
    throw new Error('Tron adapter must produce a digest payload');
  }
  const signingKey = new ethers.SigningKey(privateKeyHex);
  const sig = signingKey.sign(ethers.getBytes(payload.bytes));
  const sigParts = [{ r: sig.r, s: sig.s, recid: sig.v - 27 }];

  // 3) 组装已签名 transaction JSON（满足 tronAdapter.broadcast 的 signedJson）
  return assembleTronSigned(unsigned, { parts: sigParts });
}

/**
 * Solana 本地签名：
 *   1) 调 adapter.buildUnsigned(intent, ctx) 拿 UnsignedTx（curve=ed25519, kind=message）
 *   2) 调 registry.getSigner → localKeyringEd25519Signer.sign 产出 base58(64B sig)
 *   3) 调 adapter.assembleSigned 返回 base58 wire transaction
 *
 * MPC 路径对 Solana 暂不支持（Tron MPC hook 在 v1 抛 UNSUPPORTED_OPERATION）。
 */
async function signSolanaTransactionLocal(chainKey, accountId, transaction) {
  if (isMpcAccountId(accountId)) {
    throw Object.assign(new Error('Solana MPC signing is not implemented in v1'), {
      code: 'UNSUPPORTED_OPERATION'
    });
  }

  const adapter = getAdapter(chainKey);
  // Solana native SOL transfer：transaction 携带 { from, to, amount(lamports) }
  // 或已是 Intent shape；normalize 一下
  const intent = transaction && transaction.type
    ? transaction
    : {
        type: 'native-transfer',
        from: transaction?.from,
        to: transaction?.to,
        amount: transaction?.amount
      };
  const unsigned = await adapter.buildUnsigned(intent, { chainKey });
  const signer = getSigner(accountId, adapter);
  const sigResult = await signer.sign(unsigned, { accountId });
  return adapter.assembleSigned(unsigned, sigResult);
}

/**
 * Bitcoin 本地签名（native P2WPKH segwit）：
 *   1) adapter.buildUnsigned(intent, ctx) 拉 UTXO / 选币 / 生成每 input 的 BIP-143 sighash
 *   2) 注入发送方压缩公钥（witness 需要），逐个 sighash 用同一 secp256k1 私钥签
 *   3) adapter.assembleSigned 序列化成 segwit raw tx hex
 *
 * MPC 路径对 Bitcoin 暂不支持（v1 抛 UNSUPPORTED_OPERATION）。
 */
async function signBitcoinTransactionLocal(chainKey, accountId, transaction) {
  if (isMpcAccountId(accountId)) {
    throw Object.assign(new Error('Bitcoin MPC signing is not implemented in v1'), {
      code: 'UNSUPPORTED_OPERATION'
    });
  }

  // keyring 里的 ethers.Wallet（BTC 复用 secp256k1 曲线，私钥字节等价）。
  const wallet = getWalletInstance(accountId);
  const signingKey = new ethers.SigningKey(wallet.privateKey);

  // intent normalize：UI 传 { from, to, amount(satoshi), feeRate? }
  const intent = transaction && transaction.type
    ? transaction
    : {
        type: 'native-transfer',
        from: transaction?.from,
        to: transaction?.to,
        amount: transaction?.amount,
        feeRate: transaction?.feeRate
      };

  const unsigned = await buildBitcoinUnsigned(intent, { chainKey });

  // witness 需要发送方压缩公钥（33B）；注入 serializeState 供 assembleSigned 使用。
  const st = /** @type {any} */ (unsigned.serializeState);
  st.compressedPubkey = hexToBytes(signingKey.compressedPublicKey);

  // 逐个 input（每个 payload 是一个 BIP-143 sighash digest）用同一私钥签名。
  const parts = unsigned.payloads.map((payload) => {
    if (!payload || payload.kind !== 'digest') {
      throw new Error('Bitcoin adapter must produce digest payloads');
    }
    const sig = signingKey.sign(ethers.getBytes(payload.bytes));
    return { r: sig.r, s: sig.s, recid: sig.v - 27 };
  });

  return assembleBitcoinSigned(unsigned, { parts });
}

/**
 * 广播 rawTx，返回交易哈希。统一走 adapter.broadcast。
 * EVM 传 0x...；Tron 传已附 signature 的 JSON 串。
 * @param {string} chainKey
 * @param {string} rawTx
 * @returns {Promise<string>} txHash
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
 * Tron 路径 v1 暂不支持，抛 UNSUPPORTED_OPERATION。
 * @param {string} accountId
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function signMessage(accountId, message) {
  try {
    if (isMpcAccountId(accountId)) {
      return await mpcSignMessage(accountId, message);
    }
    // 当前调用方通过 getCurrentChainKey() 间接决定链族；Tron 路径在
    // signMessage 这一层不感知 chainKey，由调用方（如 dApp 协议）守门。
    // 钱包自身 UI（Tron 私钥导入的 popup）不走 dApp 路径。
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
 * Tron 路径 v1 暂不支持（EIP-712 是 EVM 专属）。
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
// 抑制 lint：getAccountPrivateKey 备用扩展位（Tron 路径下若 keyring 解锁方式
// 改变，可改用 vault 层直接取私钥）。
void getAccountPrivateKey;
