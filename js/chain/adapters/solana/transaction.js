// @ts-check
/**
 * Solana 交易：buildUnsigned / assembleSigned / broadcast（native SOL + SPL token transfer）
 *
 * 与 EVM 路径差异：
 *   - 不调外部 RPC 构造 raw tx（不像 Tron 走 `/wallet/createtransaction`）；
 *     wallet 自己拼 message 字节（SystemProgram.transfer + recent_blockhash）。
 *   - 摘要：ed25519 签 message 全字节（非 digest），所以 payload `kind: 'message'`、
 *     `hashAlg: null`、`bytes` 是 message 字节 hex（0x + ...）。
 *   - rawTx：base58(transaction.serialize())，签名 = ed25519 sig 64 字节 base58。
 *   - broadcast：JSON-RPC `sendTransaction` with encoding 'base58'，返回 base58 tx signature。
 *
 * v1 不实现（抛 CHAIN_ADAPTER_NOT_IMPLEMENTED）：
 *   - Versioned transactions / address lookup tables
 *   - compute budget instructions / priority fees
 *
 * SPL token transfer 已实现（TransferChecked tag=12，收款方 ATA 按需 CreateIdempotent 补建）。
 */

import nacl from '../../../../lib/nacl.js';
import { base58Decode, base58Encode } from '../../../../lib/base58.js';
import { solanaRpcCall } from './rpc.js';
import { solanaAddressToPubkey, isValidSolanaAddress } from './address.js';
import {
  Transaction,
  systemTransferInstruction,
  encodeCompactU16
} from './sysprog.js';
import {
  getAssociatedTokenAddress,
  splTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction
} from './spl.js';


/**
 * 把 Uint8Array 序列化为 `0x<hex>` 字符串（Signer 接口契约）。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  let s = '0x';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * 把 `0x<hex>` 字符串解析为 Uint8Array。
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const h = String(hex || '').startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`hexToBytes: odd length ${h.length}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * buildUnsigned:
 *   1) 解析 intent（native-transfer；amount 单位 lamports）
 *   2) 解析 from / to 为 pubkey 字节
 *   3) RPC getRecentBlockhash
 *   4) SystemProgram.transfer 指令 + Message
 *   5) 返回 UnsignedTx{ curve:'ed25519', payloads:[{kind:'message', bytes:messageHex}] }
 *
 * @param {import('../../types.d.ts').Intent} intent
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
 */
export async function buildUnsigned(intent, ctx) {
  if (intent && intent.type === 'token-transfer') {
    return buildSplTokenTransfer(intent, ctx);
  }
  if (!intent || intent.type !== 'native-transfer') {
    throw new Error(`Solana buildUnsigned: only native-transfer / token-transfer supported (got ${intent?.type})`);
  }
  const fromAddr = String(intent.from || '').trim();
  const toAddr = String(intent.to || '').trim();
  if (!fromAddr || !toAddr) {
    throw new Error('Solana buildUnsigned: from / to required');
  }
  if (!isValidSolanaAddress(fromAddr) || !isValidSolanaAddress(toAddr)) {
    throw new Error('Solana buildUnsigned: invalid from/to address');
  }
  let lamports = '';
  if (typeof intent.amount === 'string' || typeof intent.amount === 'number' || typeof intent.amount === 'bigint') {
    lamports = String(intent.amount);
  } else {
    throw new Error('Solana buildUnsigned: amount (lamports, string) is required');
  }
  if (!/^[0-9]+$/.test(lamports) || lamports === '0') {
    throw new Error(`Solana buildUnsigned: invalid amount "${lamports}" (must be positive integer lamports)`);
  }
  const fromPubkey = solanaAddressToPubkey(fromAddr);
  const toPubkey = solanaAddressToPubkey(toAddr);

  // recent blockhash
  const rh = await solanaRpcCall(ctx.chainKey, 'getRecentBlockhash', []);
  /** @type {any} */
  const r = rh;
  const blockhash = r?.value?.blockhash || r?.blockhash;
  if (!blockhash || typeof blockhash !== 'string') {
    throw new Error('Solana buildUnsigned: getRecentBlockhash returned no blockhash');
  }
  const blockhashBytes = base58Decode(blockhash);
  if (blockhashBytes.length !== 32) {
    throw new Error(`Solana buildUnsigned: blockhash must decode to 32 bytes (got ${blockhashBytes.length})`);
  }

  // 构造 message + transaction
  const tx = new Transaction({ feePayer: fromPubkey, recentBlockhash: blockhashBytes });
  tx.add(systemTransferInstruction({
    fromPubkey,
    toPubkey,
    lamports: BigInt(lamports)
  }));
  const messageBytes = tx.message.serializeMessage();

  return {
    curve: 'ed25519',
    payloads: [{
      kind: 'message',
      bytes: bytesToHex(messageBytes),
      hashAlg: null
    }],
    serializeState: { tx, messageBytes, feePayer: fromPubkey, chainKey: ctx.chainKey },
    needsRecoveryId: false
  };
}

/**
 * assembleSigned：
 *   1) 校验 sig.parts[0].signature 是 base58(64B ed25519 sig)
 *   2) 把 sig 加到 tx.signatures
 *   3) 返回 base58(tx.serialize())
 *
 * @param {import('../../types.d.ts').UnsignedTx} unsigned
 * @param {import('../../types.d.ts').SignatureResult} sig
 * @returns {string} base58 wire transaction
 */
export function assembleSigned(unsigned, sig) {
  const state = /** @type {{ tx?: Transaction, feePayer?: Uint8Array, messageBytes?: Uint8Array }} */ (unsigned?.serializeState) || {};
  const tx = state.tx;
  const feePayer = state.feePayer;
  const messageBytes = state.messageBytes;
  if (!tx || !(tx instanceof Transaction) || !feePayer || !messageBytes) {
    throw new Error('Solana assembleSigned: missing serializeState (tx/feePayer/messageBytes)');
  }
  const part = sig?.parts?.[0];
  if (!part || typeof part.signature !== 'string') {
    throw new Error('Solana assembleSigned: missing sig.parts[0].signature (base58 string)');
  }
  const sigBytes = base58Decode(part.signature);
  if (sigBytes.length !== 64) {
    throw new Error(`Solana assembleSigned: ed25519 signature must be 64 bytes (got ${sigBytes.length})`);
  }
  tx.addSignature(feePayer, sigBytes);
  const wire = tx.serialize();
  // 立即验证：重算 message 与原 messageBytes 一致（防止 serialize 引入静默 drift）
  if (!messageBytes || wire.length < messageBytes.length) {
    throw new Error('Solana assembleSigned: tx wire shorter than expected');
  }
  const embeddedMsg = wire.slice(wire.length - messageBytes.length);
  for (let i = 0; i < messageBytes.length; i++) {
    if (embeddedMsg[i] !== messageBytes[i]) {
      throw new Error('Solana assembleSigned: serialized message bytes drift');
    }
  }
  return base58Encode(wire);
}

/**
 * broadcast：JSON-RPC `sendTransaction`，返回 base58 tx signature（= txid）。
 *
 * @param {string} rawTxBase58
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<string>}
 */
export async function broadcast(rawTxBase58, ctx) {
  const txBytes = base58Decode(String(rawTxBase58 || ''));
  if (txBytes.length === 0) {
    throw new Error('Solana broadcast: empty rawTx');
  }
  const result = await solanaRpcCall(ctx.chainKey, 'sendTransaction', [
    base58Encode(txBytes),
    { encoding: 'base58', preflightCommitment: 'confirmed', skipPreflight: false }
  ]);
  if (!result || typeof result !== 'string') {
    throw new Error(`Solana broadcast: unexpected sendTransaction result: ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * 暴露给本地 ed25519 signer：直接对 message bytes 做 detached sign。
 * @param {Uint8Array} messageBytes
 * @param {Uint8Array} secretKey 64-byte nacl secretKey（含 32B seed + 32B pubkey）
 * @returns {string} base58(64B signature)
 */
export function signEd25519Message(messageBytes, secretKey) {
  if (!(messageBytes instanceof Uint8Array)) {
    throw new Error('signEd25519Message: messageBytes required');
  }
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 64) {
    throw new Error('signEd25519Message: secretKey must be 64 bytes');
  }
  const sig = nacl.sign.detached(messageBytes, secretKey);
  return base58Encode(sig);
}

/**
 * SPL token 转账（TransferChecked）。
 *   intent: { type:'token-transfer', from, to, mint, amount(base units 字符串), decimals }
 *   - source ATA = getAssociatedTokenAddress(from, mint)
 *   - dest ATA   = getAssociatedTokenAddress(to, mint)
 *   - owner = feePayer = from（本地单签）
 * 收款方 ATA 若不存在（getAccountInfo → value=null），先补一条
 * CreateIdempotent 指令由 feePayer 出资建账，再发 TransferChecked，
 * 否则给从未持有该 token 的地址转账会在链上失败。
 *
 * @param {any} intent
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
 */
export async function buildSplTokenTransfer(intent, ctx) {
  const fromAddr = String(intent?.from || '').trim();
  const toAddr = String(intent?.to || '').trim();
  const mintAddr = String(intent?.mint || intent?.token?.address || '').trim();
  if (!fromAddr || !toAddr) throw new Error('Solana token-transfer: from / to required');
  if (!mintAddr) throw new Error('Solana token-transfer: mint required');
  if (!isValidSolanaAddress(fromAddr) || !isValidSolanaAddress(toAddr)) {
    throw new Error('Solana token-transfer: invalid from/to address');
  }
  if (!isValidSolanaAddress(mintAddr)) {
    throw new Error('Solana token-transfer: invalid mint address');
  }
  const amount = String(intent?.amount ?? '');
  if (!/^[0-9]+$/.test(amount) || amount === '0') {
    throw new Error(`Solana token-transfer: invalid amount "${amount}" (token base units, positive integer)`);
  }
  const decimals = Number.isFinite(Number(intent?.decimals)) ? Number(intent.decimals) : 6;

  const fromPubkey = solanaAddressToPubkey(fromAddr);
  const toPubkey = solanaAddressToPubkey(toAddr);
  const mintPubkey = solanaAddressToPubkey(mintAddr);
  const sourceAta = getAssociatedTokenAddress(fromPubkey, mintPubkey);
  const destAta = getAssociatedTokenAddress(toPubkey, mintPubkey);

  const rh = await solanaRpcCall(ctx.chainKey, 'getRecentBlockhash', []);
  /** @type {any} */
  const r = rh;
  const blockhash = r?.value?.blockhash || r?.blockhash;
  if (!blockhash || typeof blockhash !== 'string') {
    throw new Error('Solana token-transfer: getRecentBlockhash returned no blockhash');
  }
  const blockhashBytes = base58Decode(blockhash);
  if (blockhashBytes.length !== 32) {
    throw new Error(`Solana token-transfer: blockhash must decode to 32 bytes (got ${blockhashBytes.length})`);
  }

  const tx = new Transaction({ feePayer: fromPubkey, recentBlockhash: blockhashBytes });
  // 收款方 ATA 不存在时，先补建账（CreateIdempotent，由 feePayer 出资）。
  const destAtaExists = await solanaTokenAccountExists(ctx.chainKey, destAta);
  if (!destAtaExists) {
    tx.add(createAssociatedTokenAccountInstruction({
      payer: fromPubkey,
      ata: destAta,
      owner: toPubkey,
      mint: mintPubkey
    }));
  }
  tx.add(splTransferCheckedInstruction({
    source: sourceAta,
    mint: mintPubkey,
    destination: destAta,
    owner: fromPubkey,
    amount: BigInt(amount),
    decimals
  }));
  const messageBytes = tx.message.serializeMessage();

  return {
    curve: 'ed25519',
    payloads: [{
      kind: 'message',
      bytes: bytesToHex(messageBytes),
      hashAlg: null
    }],
    serializeState: { tx, messageBytes, feePayer: fromPubkey, chainKey: ctx.chainKey },
    needsRecoveryId: false
  };
}

/**
 * 查询某 token account（ATA）是否已存在。
 *   getAccountInfo → { value: null } 表示账户不存在；{ value: {...} } 表示存在。
 * 任何 RPC 异常都保守当作「不存在」→ 触发 CreateIdempotent 补建（幂等，
 * 即使实际已存在也不会失败），避免因查询失败而漏建导致转账在链上报错。
 *
 * @param {string} chainKey
 * @param {Uint8Array} ataPubkey 32 字节
 * @returns {Promise<boolean>}
 */
export async function solanaTokenAccountExists(chainKey, ataPubkey) {
  try {
    const info = await solanaRpcCall(chainKey, 'getAccountInfo', [
      base58Encode(ataPubkey),
      { encoding: 'base64', commitment: 'confirmed' }
    ]);
    /** @type {any} */
    const r = info;
    // getAccountInfo 正常返回 { context, value: null|{...} }；有些 stub 直接返回 null。
    if (r == null) return false;
    if (typeof r === 'object' && 'value' in r) return r.value != null;
    return false;
  } catch {
    return false;
  }
}

// 暴露 encodeCompactU16 方便外部 RPC stub 与 wire 测试使用。
export { encodeCompactU16 };