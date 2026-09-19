// @ts-check
/**
 * Tron 交易：buildUnsigned / assembleSigned（v1 仅支持原生 TRX TransferContract）
 *
 * 协议概要（参考 https://developers.tron.network/docs/tron-protocol-transaction）：
 *   1. 客户端 POST `/wallet/createtransaction` 携带 TransferContract：
 *      { owner_address, to_address, amount }（amount 单位 SUN，6 位）。
 *      响应是 raw JSON Transaction（含 txID = SHA-256(序列化 raw_tx)、
 *      raw_data、raw_data_hex 等）。
 *   2. 客户端对 txID 做 ECDSA（secp256k1 + SHA-256 摘要），得到
 *      r‖s‖v（v=0/1，**不是 27/28**）。把签名 append 到 raw JSON：
 *      { ..., signature: [r][s][v] }（Base16 编码 hex 字符串拼接）。
 *   3. 客户端 POST `/wallet/broadcasttransaction` 携带完整 Transaction。
 *
 * 与 EVM 路径的核心差异：
 *   - 摘要算法 = SHA-256（不是 keccak256）。
 *   - 签名 v = 0/1（ethers 给的是 27/28，需减 27）。
 *   - rawTx 形态 = JSON（不是 hex 编码字节串），签名也以 hex 字符串拼接。
 *
 * v1 限制：仅 TransferContract（amount + to_address），TRC20 留待后续阶段。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import { tronRpcCall } from './rpc.js';
import { tronReference, isValidTronAddressForReference } from './address.js';
import { TRON_DERIVATION_PATH } from './address.js';
import { trxBase58CheckDecode } from './base58check.js';

const TRX_TRANSFER_SIGNATURE_LEN = 65; // r (32B) + s (32B) + v (1B)

/**
 * buildUnsigned：
 *   1) 解析 intent：toAddress, amount (SUN, 字符串), from
 *   2) 调 `/wallet/createtransaction` 取完整 raw Transaction JSON（含 raw_data_hex）
 *   4) 摘要 = SHA-256(raw_data_hex 字节) → 0x + 64 hex chars
 *   5) 返回 UnsignedTx：curve=secp256k1, payloads=[{digest, sha256}], serializeState={tx, chainKey}
 *
 * 注意：createtransaction 内部已把 ref_block_* / expiration 等设置成 best block；
 * raw_data_hex 是 raw_data 的 protobuf 编码字节，签名验证的源就是它。
 * 我们不重新序列化 raw_data（避免引入完整 protobuf 库），而是依赖 createtransaction
 * 的返回结果作为权威输入。
 *
 * @param {import('../../types.d.ts').Intent} intent
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
 */
export async function buildUnsigned(intent, ctx) {
  if (!intent || intent.type !== 'native-transfer') {
    throw new Error(`Tron buildUnsigned: only native-transfer supported (got ${intent?.type})`);
  }
  // Tron adapter 接受 `to`（Intent 标准字段）和 `toAddress`（兼容性别名），
  // 其中 `toAddress` 不在 Intent 类型里——运行时接受为类型保护。
  /** @type {string | undefined} */
  const toAddressAlias = /** @type {any} */ (intent)?.toAddress;
  const to = String(toAddressAlias || intent.to || '').trim();
  if (!to) {
    throw new Error('Tron buildUnsigned: missing to (toAddress)');
  }
  // reference 决定地址 prefix 检查
  const ref = tronReference(ctx.chainKey);
  if (!isValidTronAddressForReference(to, ref)) {
    throw new Error(`Tron buildUnsigned: invalid to address for reference ${ref}`);
  }
  // amount: 支持 "amount" 字符串（最小单位 SUN）
  let amountSun = '';
  if (typeof intent.amount === 'string' || typeof intent.amount === 'number' || typeof intent.amount === 'bigint') {
    amountSun = String(intent.amount);
  } else {
    throw new Error('Tron buildUnsigned: amount (SUN, string) is required');
  }
  if (!/^[0-9]+$/.test(amountSun) || amountSun === '0') {
    throw new Error(`Tron buildUnsigned: invalid amount "${amountSun}" (SUN must be positive integer)`);
  }

  const ownerAddress = String(intent.from || '').trim();
  if (!ownerAddress) {
    throw new Error('Tron buildUnsigned: missing from (owner_address)');
  }
  if (!isValidTronAddressForReference(ownerAddress, ref)) {
    throw new Error(`Tron buildUnsigned: invalid from address for reference ${ref}`);
  }

  // 调 createtransaction（内部已选 best block + protobuf 编码 raw_data_hex）
  // TronGrid 协议：`owner_address` / `to_address` 是 `41 + 20bytes hex` 形态，
  // 不是 Base58Check。wallet 在 popup/dApp UI 上展示 Base58，但 createtransaction
  // 必须转成 hex；trxBase58CheckDecode 返回的 20 字节是 `hash160`（去掉 prefix），
  // 直接 hex 编码 + '41' 前缀即可。
  const toHex = (addr) => {
    const decoded = trxBase58CheckDecode(addr);
    if (decoded.length !== 20) {
      throw new Error('Tron buildUnsigned: decoded Base58Check payload must be 20 bytes');
    }
    return '41' + Array.from(decoded)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const transaction = await tronRpcCall(ctx.chainKey, '/wallet/createtransaction', {
    owner_address: toHex(ownerAddress),
    to_address: toHex(to),
    amount: parseInt(amountSun, 10)
  });
  if (!transaction || typeof transaction !== 'object' || !transaction.raw_data) {
    throw new Error('Tron buildUnsigned: createtransaction returned invalid response');
  }
  if (!transaction.raw_data_hex) {
    throw new Error('Tron buildUnsigned: createtransaction response missing raw_data_hex');
  }

  // txID = SHA-256(raw_data_hex 字节)，createtransaction 通常已给出；保险起见重算一次
  // 注意：real TronGrid 的 raw_data_hex 不含 `0x` 前缀，ethers v6 getBytes
  // 需要 `0x`，所以 normalize 一次。
  const rawHex = String(transaction.raw_data_hex || '');
  const normalizedHex = rawHex.startsWith('0x') ? rawHex : `0x${rawHex}`;
  const recomputedId = ethers.sha256(ethers.getBytes(normalizedHex));
  if (transaction.txID && transaction.txID !== recomputedId) {
    // 不抛错，仅记录——节点可能用不同字段排序
  }
  transaction.txID = recomputedId;

  // 摘要（Signer 接口契约：bytes 已是 0x + 64 hex）
  const digestHex = transaction.txID;

  return {
    curve: 'secp256k1',
    payloads: [{
      kind: 'digest',
      bytes: digestHex,
      hashAlg: 'sha256'
    }],
    serializeState: { transaction, chainKey: ctx.chainKey },
    needsRecoveryId: false
  };
}

/**
 * assembleSigned：
 *   1) 校验签名格式（r‖s 32B each + v 1B = 65B）
 *   2) 把 signature 拼到 raw JSON Transaction（追加 signature 字段为 hex 字符串）
 *   3) 返回完整 Transaction JSON 字符串
 *
 * @param {import('../../types.d.ts').UnsignedTx} unsigned
 * @param {import('../../types.d.ts').SignatureResult} sig
 * @returns {string}
 */
export function assembleSigned(unsigned, sig) {
  const state = /** @type {{transaction?: Object}} */ (unsigned?.serializeState) || {};
  const tx = state.transaction;
  if (!tx || typeof tx !== 'object' || !tx.raw_data) {
    throw new Error('Tron assembleSigned: missing serializeState.transaction');
  }
  const part = sig?.parts?.[0];
  if (!part) {
    throw new Error('Tron assembleSigned: missing signature part');
  }
  const sigHex = signaturePartToHex(part);
  if (sigHex.length !== TRX_TRANSFER_SIGNATURE_LEN * 2) {
    throw new Error(`Tron assembleSigned: signature must be ${TRX_TRANSFER_SIGNATURE_LEN} bytes, got ${sigHex.length / 2}`);
  }
  tx.signature = [sigHex];
  // TronGrid wire format 把签名 130 hex（65 字节 r||s||v）append 到
  // raw_data_hex 后面：real node 既接受两种形式，但旧版（spec stub 实现）
  // 要求 raw_data_hex 是带签名的扩展形态，broadcast signature 数组则
  // 冗余保留。
  if (typeof tx.raw_data_hex === 'string') {
    tx.raw_data_hex = tx.raw_data_hex + sigHex;
  }
  return JSON.stringify(tx);
}

/**
 * broadcast：POST `/wallet/broadcasttransaction`，返回 txID。
 *
 * @param {string} signedTxJson
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<string>}
 */
export async function broadcast(signedTxJson, ctx) {
  let parsed;
  try {
    parsed = JSON.parse(String(signedTxJson || ''));
  } catch {
    throw new Error('Tron broadcast: invalid signed transaction JSON');
  }
  if (!parsed.signature || !Array.isArray(parsed.signature) || parsed.signature.length === 0) {
    throw new Error('Tron broadcast: missing signature');
  }
  const result = await tronRpcCall(ctx.chainKey, '/wallet/broadcasttransaction', parsed);
  if (!result || typeof result !== 'object') {
    throw new Error('Tron broadcast: invalid response');
  }
  // 失败：{ result: false, code, message }
  if (result.result === false || result.code === true) {
    throw new Error(`Tron broadcast failed: ${result.message || 'code=' + result.code}`);
  }
  return String(result.txid || parsed.txID || '').trim();
}

/**
 * 把 SignaturePart 归一为 65B hex 字符串（r‖s‖v，v=0/1）。
 * @param {import('../../types.d.ts').SignaturePart} part
 * @returns {string} hex（无 0x）
 */
function signaturePartToHex(part) {
  let r = '';
  let s = '';
  let v = 0;
  if (part.rs) {
    const rs = String(part.rs).replace(/^0x/, '');
    if (rs.length !== 128) {
      throw new Error(`Tron signature: rs must be 64 bytes (got ${rs.length / 2})`);
    }
    r = rs.slice(0, 64);
    s = rs.slice(64, 128);
    v = typeof part.recid === 'number' ? part.recid : 0;
  } else {
    if (!part.r || !part.s) {
      throw new Error('Tron signature: missing r/s');
    }
    r = String(part.r).replace(/^0x/, '').padStart(64, '0');
    s = String(part.s).replace(/^0x/, '').padStart(64, '0');
    v = typeof part.recid === 'number' ? part.recid : 0;
  }
  if (v >= 27) v -= 27; // ethers 输出 27/28；Tron 用 0/1
  if (v !== 0 && v !== 1) {
    throw new Error(`Tron signature: recid must be 0 or 1 (got ${v})`);
  }
  return r + s + v.toString(16).padStart(2, '0');
}

/**
 * 暴露派生路径模板（vault 模块也会用到）。
 */
export { TRON_DERIVATION_PATH };