// @ts-check
/**
 * Tron 链适配器（tron / secp256k1 / coinType 195）
 *
 * 阶段 1+ 落地：
 *   - chainKey / isValidAddress / displayAddress
 *   - buildUnsigned / assembleSigned / broadcast（v1 仅支持 native-transfer / TRX）
 *   - getNativeBalance（TRX；TRC20 抛 NOT_IMPLEMENTED）
 *
 * v1 不实现（抛 CHAIN_ADAPTER_NOT_IMPLEMENTED）：
 *   - signMessage / signTypedData / estimateFee / getTxStatus / deriveAddress
 *   - TRC20 transfer
 */

import {
  isValidTronAddress,
  chainKeyFromTronNetwork
} from './address.js';
import {
  TRON_NAMESPACE,
  TRON_COIN_TYPE,
  tronReference
} from './address.js';
import { buildUnsigned, assembleSigned, broadcast } from './transaction.js';
import { getNativeBalance, getTokenBalance } from './balance.js';

const NOT_IMPLEMENTED = 'CHAIN_ADAPTER_NOT_IMPLEMENTED';

/** @type {import('../../types.d.ts').ChainAdapter} */
export const tronAdapter = {
  namespace: TRON_NAMESPACE,
  family: 'tron',
  curve: 'secp256k1',
  coinType: TRON_COIN_TYPE,

  chainKey: (net) => chainKeyFromTronNetwork(/** @type {any} */(net) || {}),
  isValidAddress: isValidTronAddress,
  displayAddress: (addr) => String(addr || '').trim(),

  async buildUnsigned(intent, ctx) {
    return buildUnsigned(intent, ctx);
  },

  assembleSigned(unsigned, sig) {
    return assembleSigned(unsigned, sig);
  },

  async broadcast(rawTx, ctx) {
    return broadcast(rawTx, ctx);
  },

  getNativeBalance,
  getTokenBalance
};

/**
 * 仅做 ledger：暴露给 registry 由这个 vault 注册使用。
 */
export default tronAdapter;

// 暴露 helper 给上层按需使用（例如 UI 想展示 reference / chainKey 等）
export { TRON_NAMESPACE, TRON_COIN_TYPE, tronReference };