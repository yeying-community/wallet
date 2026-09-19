// @ts-check
/**
 * ed25519 本地私钥签名器（local-keyring-ed25519）
 *
 * 镜像 local-keyring.js 的 secp256k1 形态：从 keyring cache 取 ed25519 keypair，
 * 对每个 payload 签（ed25519 走 message 而非 digest）。
 *
 * sign() 接受 SignPayload[]：
 *   - kind: 'message'（ed25519 签原文）+  'digest'（不适用，抛错）
 *
 * 返回 SignatureResult.parts：每 part 是 `{ signature: base58(64B sig) }`。
 */

import { getWalletInstanceByCurve } from '../../background/keyring.js';
import { signEd25519Message } from '../adapters/solana/transaction.js';

/** @type {import('../types.d.ts').Signer} */
export const localKeyringEd25519Signer = {
  supportedCurves: new Set(['ed25519']),

  /**
   * 对 UnsignedTx 的每个 message payload 产出 ed25519 signature。
   * @param {import('../types.d.ts').UnsignedTx} unsigned
   * @param {import('../types.d.ts').SignCtx} ctx
   * @returns {Promise<import('../types.d.ts').SignatureResult>}
   */
  async sign(unsigned, ctx) {
    const keypair = getWalletInstanceByCurve(ctx.accountId, 'ed25519');
    if (!keypair || !keypair.secretKey) {
      throw new Error('localKeyringEd25519Signer: missing ed25519 keypair in cache');
    }
    const parts = (unsigned?.payloads || []).map((payload) => {
      if (payload.kind !== 'message') {
        throw new Error(`LOCAL_KEYRING_ED25519_UNSUPPORTED_PAYLOAD: ${payload.kind}`);
      }
      // payload.bytes 是 0x<hex>，解析为 Uint8Array
      const hex = String(payload.bytes || '');
      const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
      if (raw.length % 2 !== 0) {
        throw new Error('localKeyringEd25519Signer: payload bytes has odd length');
      }
      const messageBytes = new Uint8Array(raw.length / 2);
      for (let i = 0; i < messageBytes.length; i++) {
        messageBytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
      }
      const signature = signEd25519Message(messageBytes, keypair.secretKey);
      return { signature };
    });
    return { parts };
  }
};

export default localKeyringEd25519Signer;