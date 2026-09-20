// @ts-check
/**
 * Bitcoin 链适配器（bip122 / secp256k1 / coinType 0）
 *
 * v1 落地：
 *   - chainKey / isValidAddress / displayAddress
 *   - buildUnsigned / assembleSigned / broadcast（native P2WPKH segwit transfer）
 *   - getNativeBalance（BTC；无 token 层）
 *
 * v1 不实现（抛 CHAIN_ADAPTER_NOT_IMPLEMENTED / 上层守门）：
 *   - signMessage / signTypedData / P2TR key-path 发送 / RBF / PSBT 互操作
 */

import {
  isValidBitcoinAddress,
  displayBitcoinAddress,
  chainKeyFromBip122Network,
  BIP122_NAMESPACE,
  BIP122_COIN_TYPE,
  bip122Reference
} from './address.js';
import { buildUnsigned, assembleSigned, broadcast } from './transaction.js';
import { getNativeBalance, getTokenBalance } from './balance.js';

/** @type {import('../../types.d.ts').ChainAdapter} */
export const bitcoinAdapter = {
  namespace: BIP122_NAMESPACE,
  family: 'utxo',
  curve: 'secp256k1',
  coinType: BIP122_COIN_TYPE,

  chainKey: (net) => chainKeyFromBip122Network(/** @type {any} */(net) || {}),
  isValidAddress: isValidBitcoinAddress,
  displayAddress: displayBitcoinAddress,

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

export default bitcoinAdapter;

export { BIP122_NAMESPACE, BIP122_COIN_TYPE, bip122Reference };
