// @ts-check
/**
 * 链适配器 / 签名器注册表
 *
 * getAdapter(chainKey)：按 CAIP-2 namespace 选适配器；阶段 0 仅 eip155→evmAdapter，
 * 阶段 1+ 加入 tron→tronAdapter。
 * getSigner(account)：按账户来源（本地 / MPC）选签名器，并校验 adapter.curve 落在
 * signer.supportedCurves 内（secp256k1 ⊥ ed25519 的守门点）。
 *
 * MPC 账户不返回 Signer：其编排走 signing-service，此处抛 MPC_REDIRECT。
 */

import { namespaceOf } from './chain-key.js';
import { evmAdapter } from './adapters/evm/index.js';
import { tronAdapter } from './adapters/tron/index.js';
import { solanaAdapter } from './adapters/solana/index.js';
import { bitcoinAdapter } from './adapters/bip122/index.js';
import { localKeyringSigner } from './signers/local-keyring.js';
import { localKeyringEd25519Signer } from './signers/local-keyring-ed25519.js';
import { isMpcAccountId } from '../background/signing.js';

const UNSUPPORTED_CHAIN = 'UNSUPPORTED_CHAIN';
// MPC 走 signing-service 的 mpcSignTransaction/mpcSignMessage/mpcSignTypedData
// （编排层级超出 Signer 接口的 digest→SignatureResult 形态）；registry 给出
// 明确重定向错误，调用方应改走 signing-service。
const MPC_REDIRECT = 'MPC_SIGNER_USE_SIGNING_SERVICE';

/**
 * 按 chainKey 取适配器。
 * @param {string} chainKey
 * @returns {import('./types.d.ts').ChainAdapter}
 */
export function getAdapter(chainKey) {
  const ns = namespaceOf(chainKey);
  if (ns === 'eip155') {
    return evmAdapter;
  }
  if (ns === 'tron') {
    return tronAdapter;
  }
  if (ns === 'solana') {
    return solanaAdapter;
  }
  if (ns === 'bip122') {
    return bitcoinAdapter;
  }
  throw new Error(`${UNSUPPORTED_CHAIN}: ${chainKey}`);
}

/**
 * 按账户取签名器，并校验曲线兼容。
 * MPC 账户不返回 Signer：其编排走 signing-service，此处抛 MPC_REDIRECT。
 * @param {{id?: string}|string} account 账户对象或 accountId
 * @param {import('./types.d.ts').ChainAdapter} adapter
 * @returns {import('./types.d.ts').Signer}
 */
export function getSigner(account, adapter) {
  const accountId = typeof account === 'string' ? account : String(account?.id || '');
  if (isMpcAccountId(accountId)) {
    throw new Error(`${MPC_REDIRECT}: ${accountId}`);
  }
  // 按曲线选 signer：secp256k1 → localKeyringSigner；ed25519 → localKeyringEd25519Signer
  if (adapter && adapter.curve === 'ed25519') {
    assertCurveCompatible(adapter, localKeyringEd25519Signer);
    return localKeyringEd25519Signer;
  }
  assertCurveCompatible(adapter, localKeyringSigner);
  return localKeyringSigner;
}

/**
 * @param {import('./types.d.ts').ChainAdapter} adapter
 * @param {import('./types.d.ts').Signer} signer
 */
function assertCurveCompatible(adapter, signer) {
  if (adapter && signer && !signer.supportedCurves.has(adapter.curve)) {
    throw new Error(
      `CURVE_MISMATCH: adapter ${adapter.namespace} needs ${adapter.curve}, `
      + `signer supports ${[...signer.supportedCurves].join(',')}`
    );
  }
}
