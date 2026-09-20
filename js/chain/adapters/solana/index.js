// @ts-check
/**
 * Solana chain-adapter（solana / ed25519 / coinType 501）
 *
 * 阶段 1+ 落地：
 *   - chainKey / isValidAddress / displayAddress
 *   - buildUnsigned / assembleSigned / broadcast（v1 仅 native-transfer）
 *   - getNativeBalance（SOL lamports；SPL token 抛 NOT_IMPLEMENTED，Phase 3）
 *
 * v1 不实现（抛 CHAIN_ADAPTER_NOT_IMPLEMENTED）：
 *   - signMessage / signTypedData / estimateFee / getTxStatus / deriveAddress
 *   - SPL token transfer
 */

import {
  isValidSolanaAddress,
  displaySolanaAddress,
  chainKeyFromSolanaNetwork,
  SOLANA_NAMESPACE,
  SOLANA_COIN_TYPE,
  solanaReference
} from './address.js';
import { buildUnsigned, assembleSigned, broadcast } from './transaction.js';
import { getNativeBalance, getTokenBalance } from './balance.js';

/** @type {import('../../types.d.ts').ChainAdapter} */
export const solanaAdapter = {
  namespace: SOLANA_NAMESPACE,
  family: 'solana',
  curve: 'ed25519',
  coinType: SOLANA_COIN_TYPE,

  chainKey: (net) => chainKeyFromSolanaNetwork(/** @type {any} */(net) || {}),
  isValidAddress: isValidSolanaAddress,
  displayAddress: displaySolanaAddress,

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

export default solanaAdapter;

// 暴露 helper 给上层按需使用
export { SOLANA_NAMESPACE, SOLANA_COIN_TYPE, solanaReference };