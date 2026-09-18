// @ts-check
/**
 * 本地私钥签名器（local-keyring）
 *
 * 按密钥来源区分的 Signer：吸收 ethers.Wallet（getWalletInstance）。仅支持
 * secp256k1。sign() 是纯曲线操作——对已哈希的 digest 产出 r/s/recid；交易的
 * nonce/gas 填充由上层 signing-service（Step 2）在 buildUnsigned 之前完成，
 * 消息/typed data 的 EIP-191/712 前缀签名走 signMessage/signTypedData（返回 sigHex）。
 *
 * 阶段 0 Step 1 为纯新增、暂不被调用方引用。
 */

import { getWalletInstance } from '../../background/keyring.js';

/** @type {import('../types.d.ts').Signer} */
export const localKeyringSigner = {
  supportedCurves: new Set(['secp256k1']),

  /**
   * 对 UnsignedTx 的每个 digest payload 产出签名分量。
   * @param {import('../types.d.ts').UnsignedTx} unsigned
   * @param {import('../types.d.ts').SignCtx} ctx
   * @returns {Promise<import('../types.d.ts').SignatureResult>}
   */
  async sign(unsigned, ctx) {
    const wallet = getWalletInstance(ctx.accountId);
    const parts = (unsigned?.payloads || []).map((payload) => {
      if (payload.kind !== 'digest') {
        throw new Error(`LOCAL_KEYRING_UNSUPPORTED_PAYLOAD: ${payload.kind}`);
      }
      const sig = wallet.signingKey.sign(payload.bytes);
      return {
        r: sig.r,
        s: sig.s,
        recid: sig.yParity
      };
    });
    return { parts };
  }
};

export default localKeyringSigner;
