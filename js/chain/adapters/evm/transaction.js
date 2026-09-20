// @ts-check
/**
 * EVM 交易归一化 / 待签构造 / 签名组装（从 signing.js 忠实搬迁 + 适配层封装）
 *
 * - normalizeTransaction / normalizeMpcSigningPayload / buildMpcSignedTransaction：
 *   与旧 signing.js 实现逐字节一致，保留供 MPC 编排与对拍测试使用。
 * - buildUnsignedTransaction / assembleSignedTransaction：新的 adapter 形态封装，
 *   产出 UnsignedTx / 由 SignatureResult 重组 rawTx。assembleSignedTransaction 的
 *   输出必须与 buildMpcSignedTransaction 对同一交易 + 同一签名逐字节一致。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import { normalizeTypedData } from './typed-data.js';
import { normalizeMpcSignatureParts } from './secp256k1-utils.js';

/**
 * @param {Object} transaction
 * @returns {Object}
 */
export function normalizeTransaction(transaction) {
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
 * MPC 签名前的 payload 归一化（message / transaction / typed_data）。
 * 与旧 signing.js 逐字节一致。
 * @param {'message'|'transaction'|'typed_data'|string} kind
 * @param {Object} payload
 * @returns {Object}
 */
export function normalizeMpcSigningPayload(kind, payload) {
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

/**
 * 由交易 payload + 签名源重组 rawTx（旧 signing.js 实现，保留供对拍）。
 * @param {{request?: {payload?: Object, type?: string}}} context
 * @param {*} signatureSource
 * @returns {string}
 */
export function buildMpcSignedTransaction(context, signatureSource) {
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

/**
 * 由归一化后的交易对象构造 UnsignedTx（adapter 形态）。
 * @param {Object} transaction 原始交易对象（未归一化亦可）
 * @returns {import('../../types.d.ts').UnsignedTx}
 */
export function buildUnsignedTransaction(transaction) {
  const normalized = normalizeTransaction(transaction || {});
  const unsignedTx = ethers.Transaction.from(normalized);
  return {
    curve: 'secp256k1',
    payloads: [{
      kind: 'digest',
      bytes: unsignedTx.unsignedHash,
      hashAlg: 'keccak256'
    }],
    serializeState: { transaction: normalized },
    needsRecoveryId: true
  };
}

/**
 * 由 UnsignedTx.serializeState + SignatureResult 重组 rawTx。
 * 输出与 buildMpcSignedTransaction 对同一交易/签名逐字节一致。
 * @param {import('../../types.d.ts').UnsignedTx} unsigned
 * @param {import('../../types.d.ts').SignatureResult} sigResult
 * @returns {string}
 */
export function assembleSignedTransaction(unsigned, sigResult) {
  const state = /** @type {{transaction?: Object}} */ (unsigned?.serializeState) || {};
  const transaction = state.transaction || {};
  const part = sigResult?.parts?.[0];
  const signature = normalizeMpcSignatureParts(signaturePartToSource(part));
  if (!signature) {
    return '';
  }
  const tx = ethers.Transaction.from(transaction);
  tx.signature = signature;
  return tx.serialized;
}

/**
 * SignaturePart → normalizeMpcSignatureParts 可消费的 source。
 * @param {import('../../types.d.ts').SignaturePart} [part]
 * @returns {Object}
 */
function signaturePartToSource(part) {
  if (!part || typeof part !== 'object') return {};
  if (part.rs) {
    const rs = String(part.rs).replace(/^0x/, '');
    return { r: `0x${rs.slice(0, 64)}`, s: `0x${rs.slice(64, 128)}`, recid: part.recid };
  }
  return { r: part.r, s: part.s, recid: part.recid };
}
