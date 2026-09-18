// @ts-check
/**
 * EVM 链适配器（eip155 / secp256k1 / coinType 60）
 *
 * 阶段 0 落地：chainKey / 地址校验 / buildUnsigned(交易) / assembleSigned。
 * broadcast 与余额查询在阶段 0 Step 2 接入 rpc.js / balance.js 后填充，
 * 现以 NOT_IMPLEMENTED 占位；estimateFee / summarize / getTxStatus / deriveAddress
 * 留待阶段 2+。此模块在 Step 1 为纯新增、暂不被任何调用方引用。
 */

import { DEFAULT_COIN_TYPE, chainKeyFromNetwork } from '../../chain-key.js';
import { isValidAddress, displayAddress } from './address.js';
import {
  buildUnsignedTransaction,
  assembleSignedTransaction
} from './transaction.js';

const NOT_IMPLEMENTED = 'CHAIN_ADAPTER_NOT_IMPLEMENTED';

/** @type {import('../../types.d.ts').ChainAdapter} */
export const evmAdapter = {
  namespace: 'eip155',
  family: 'evm',
  curve: 'secp256k1',
  coinType: DEFAULT_COIN_TYPE,

  chainKey: chainKeyFromNetwork,
  isValidAddress,
  displayAddress,

  /**
   * @param {import('../../types.d.ts').Intent} intent
   * @param {import('../../types.d.ts').ChainCtx} _ctx
   * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
   */
  async buildUnsigned(intent, _ctx) {
    if (intent?.type === 'sign-transaction' || intent?.transaction) {
      return buildUnsignedTransaction(intent.transaction);
    }
    throw new Error(`${NOT_IMPLEMENTED}: buildUnsigned(${intent?.type})`);
  },

  /**
   * @param {import('../../types.d.ts').UnsignedTx} unsigned
   * @param {import('../../types.d.ts').SignatureResult} sig
   * @returns {string}
   */
  assembleSigned(unsigned, sig) {
    return assembleSignedTransaction(unsigned, sig);
  },

  /**
   * 广播 rawTx。Step 2 接入 adapters/evm/rpc.js 后实现。
   * @param {string} _rawTx
   * @param {import('../../types.d.ts').ChainCtx} _ctx
   * @returns {Promise<string>}
   */
  async broadcast(_rawTx, _ctx) {
    throw new Error(`${NOT_IMPLEMENTED}: broadcast`);
  }
};

export default evmAdapter;
