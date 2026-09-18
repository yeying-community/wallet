// @ts-check
/**
 * MPC (cggmp24) secp256k1 编排封装
 *
 * 阶段 0 Step 4：把 signing.js 的 MPC 编排（prepareMpcWalletForSigning /
 * createMpcSignContext / startMpcWireSigning）收敛为一个内部 helper 集合，
 * 由 signing-service 统一调用。MPC 编排涉及 wire session、多方协议、异步
 * 等待，语义上比 registry 的 Signer（digest → SignatureResult）丰富，不强行
 * 套入 Signer 接口；signing-service 统一 “signer 出来就是 rawTx → broadcast”
 * 的语义。
 *
 * MPC 未完成时仍抛 MPC_SIGNING_PENDING（语义不变），由 request-router 的
 * waitForMpcSignatureCompletion 收尾。
 */

import {
  prepareMpcWalletForSigning,
  createMpcSignContext,
  startMpcWireSigning
} from '../../background/signing.js';

/**
 * MPC 交易签名：返回已组装的 rawTx（0x + RLP 序列化）。
 * @param {string} accountId
 * @param {Object} transaction 归一化前的交易对象
 * @returns {Promise<string>} rawTx
 */
export async function mpcSignTransaction(accountId, transaction) {
  const wallet = await prepareMpcWalletForSigning(accountId);
  const context = await createMpcSignContext(wallet, 'transaction', { transaction });
  return await startMpcWireSigning(wallet, context);
}

/**
 * MPC 消息签名：返回 65B 签名 hex（0x + r‖s‖v）。
 * @param {string} accountId
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function mpcSignMessage(accountId, message) {
  const wallet = await prepareMpcWalletForSigning(accountId);
  const context = await createMpcSignContext(wallet, 'message', { message });
  return await startMpcWireSigning(wallet, context);
}

/**
 * MPC 类型化数据签名：返回 65B 签名 hex。
 * @param {string} accountId
 * @param {Object} domain
 * @param {Object} types
 * @param {Object} value
 * @returns {Promise<string>}
 */
export async function mpcSignTypedData(accountId, domain, types, value) {
  const wallet = await prepareMpcWalletForSigning(accountId);
  const context = await createMpcSignContext(wallet, 'typed_data', { domain, types, value });
  return await startMpcWireSigning(wallet, context);
}
