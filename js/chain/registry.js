// @ts-check
/**
 * 链适配器 / 签名器注册表
 *
 * getAdapter(chainKey)：按 CAIP-2 namespace 选适配器；阶段 0 仅 eip155→evmAdapter。
 * getSigner(account)：按账户来源（本地 / MPC）选签名器，并校验 adapter.curve 落在
 * signer.supportedCurves 内（secp256k1 ⊥ ed25519 的守门点）。
 *
 * 阶段 0 Step 1 为纯新增、暂不被引用；mpc-cggmp24 签名器在 Step 2 接入，此处对 MPC
 * 账户暂抛 NOT_IMPLEMENTED。
 */

import { namespaceOf } from './chain-key.js';
import { evmAdapter } from './adapters/evm/index.js';
import { localKeyringSigner } from './signers/local-keyring.js';
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
