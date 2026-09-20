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
  const type = intent?.type;
  if (type === 'token-transfer') {
    return buildTrc20Unsigned(intent, ctx);
  }
  if (!intent || type !== 'native-transfer') {
    throw new Error(`Tron buildUnsigned: only native-transfer / token-transfer supported (got ${type})`);
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
  const transaction = await tronRpcCall(ctx.chainKey, '/wallet/createtransaction', {
    owner_address: tronAddressToHex(ownerAddress),
    to_address: tronAddressToHex(to),
    amount: parseInt(amountSun, 10)
  });
  return finalizeUnsigned(transaction, ctx.chainKey);
}

/**
 * TRC20 token-transfer：走 `/wallet/triggersmartcontract` 构造
 * transfer(address,uint256) 调用；返回的 UnsignedTx 与 native 同形态
 *（digest = SHA-256(raw_data_hex)，secp256k1）。
 *
 * intent 形态：
 *   { type: 'token-transfer', from, to, tokenAddress, amount, feeLimitSun? }
 *   - to: 收款人 Base58
 *   - tokenAddress: TRC20 合约 Base58
 *   - amount: token 最小单位整数字符串（= 人类可读 × 10^decimals）
 *
 * @param {any} intent
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
 */
async function buildTrc20Unsigned(intent, ctx) {
  const ref = tronReference(ctx.chainKey);
  const to = String(intent?.to || intent?.toAddress || '').trim();
  const owner = String(intent?.from || '').trim();
  const contract = String(intent?.tokenAddress || intent?.token?.address || '').trim();
  if (!to) throw new Error('Tron token-transfer: missing to');
  if (!owner) throw new Error('Tron token-transfer: missing from');
  if (!contract) throw new Error('Tron token-transfer: missing tokenAddress');
  if (!isValidTronAddressForReference(to, ref)) {
    throw new Error(`Tron token-transfer: invalid to address for reference ${ref}`);
  }
  if (!isValidTronAddressForReference(owner, ref)) {
    throw new Error(`Tron token-transfer: invalid from address for reference ${ref}`);
  }
  const amount = String(intent?.amount ?? '');
  if (!/^[0-9]+$/.test(amount) || amount === '0') {
    throw new Error(`Tron token-transfer: invalid amount "${amount}" (must be positive integer, token base units)`);
  }
  const feeLimit = Number.isFinite(Number(intent?.feeLimitSun)) && Number(intent?.feeLimitSun) > 0
    ? Math.floor(Number(intent.feeLimitSun))
    : 15_000_000; // 15 TRX 默认上限

  // transfer(address,uint256) 的 ABI 参数：address 用 20 字节 hash160 左补 32 字节，
  // amount 用 uint256 左补 32 字节。
  const parameter = tronAddressToAbiParam(to) + BigInt(amount).toString(16).padStart(64, '0');

  const resp = await tronRpcCall(ctx.chainKey, '/wallet/triggersmartcontract', {
    owner_address: tronAddressToHex(owner),
    contract_address: tronAddressToHex(contract),
    function_selector: 'transfer(address,uint256)',
    parameter,
    fee_limit: feeLimit,
    call_value: 0
  });
  // triggersmartcontract 把 raw tx 嵌在 `.transaction`；校验合约调用是否成功构造。
  const result = resp?.result;
  if (result && result.result === false) {
    const msg = result.message ? hexToUtf8(result.message) : (result.code || 'contract call failed');
    throw new Error(`Tron token-transfer: triggersmartcontract failed: ${msg}`);
  }
  const transaction = resp?.transaction;
  if (!transaction || typeof transaction !== 'object') {
    throw new Error('Tron token-transfer: triggersmartcontract returned no transaction');
  }
  return finalizeUnsigned(transaction, ctx.chainKey);
}

/**
 * 把 createtransaction / triggersmartcontract 返回的 raw tx JSON 收敛为 UnsignedTx。
 * @param {any} transaction
 * @param {string} chainKey
 * @returns {import('../../types.d.ts').UnsignedTx}
 */
function finalizeUnsigned(transaction, chainKey) {
  if (!transaction || typeof transaction !== 'object' || !transaction.raw_data) {
    throw new Error('Tron buildUnsigned: response returned invalid transaction');
  }
  if (!transaction.raw_data_hex) {
    throw new Error('Tron buildUnsigned: transaction missing raw_data_hex');
  }
  // txID = SHA-256(raw_data_hex 字节)；real node 不带 `0x` 前缀，normalize 后重算。
  const rawHex = String(transaction.raw_data_hex || '');
  const normalizedHex = rawHex.startsWith('0x') ? rawHex : `0x${rawHex}`;
  transaction.txID = ethers.sha256(ethers.getBytes(normalizedHex));
  return {
    curve: 'secp256k1',
    payloads: [{
      kind: 'digest',
      bytes: transaction.txID,
      hashAlg: 'sha256'
    }],
    serializeState: { transaction, chainKey },
    needsRecoveryId: false
  };
}

/**
 * Base58Check 地址 → TronGrid `41 + hash160` hex 形态。
 * @param {string} addr
 * @returns {string}
 */
function tronAddressToHex(addr) {
  const decoded = trxBase58CheckDecode(addr);
  if (decoded.length !== 20) {
    throw new Error('Tron buildUnsigned: decoded Base58Check payload must be 20 bytes');
  }
  return '41' + Array.from(decoded).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Base58Check 地址 → ABI address 参数（20 字节 hash160 左补 32 字节 = 64 hex）。
 * @param {string} addr
 * @returns {string}
 */
function tronAddressToAbiParam(addr) {
  const decoded = trxBase58CheckDecode(addr);
  if (decoded.length !== 20) {
    throw new Error('Tron token-transfer: decoded Base58Check payload must be 20 bytes');
  }
  let hex = '';
  for (const b of decoded) hex += b.toString(16).padStart(2, '0');
  return hex.padStart(64, '0');
}

/**
 * TronGrid 错误 message 常以 hex 返回，转 UTF-8 便于展示。
 * @param {string} hex
 * @returns {string}
 */
function hexToUtf8(hex) {
  try {
    const clean = String(hex).replace(/^0x/, '');
    if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) return String(hex);
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch {
    return String(hex);
  }
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