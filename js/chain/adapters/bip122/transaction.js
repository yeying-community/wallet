// @ts-check
/**
 * Bitcoin 交易构造 / 签名组装 / 广播（native P2WPKH segwit, BIP-141 + BIP-143）
 *
 * 范围（v1）：
 *   - 发送方固定 P2WPKH（native segwit）。收件人可为任意标准类型（addressToScriptPubKey）。
 *   - UTXO 选择：simple greedy（largest-first），累加到覆盖 amount+fee。
 *   - 每个输入产出一个 BIP-143 sighash（SIGHASH_ALL），交给 secp256k1 keyring 逐个签。
 *   - 组装 witness（<DER-sig+01> <compressed-pubkey>），序列化带 marker/flag 的 segwit tx。
 *
 * 不支持：P2TR key-path 签名（BIP-341）、RBF 特殊 sequence、multisig、PSBT 互操作。
 *
 * 单位：satoshi（1 BTC = 1e8 sat）。amount 传 satoshi 字符串 / bigint。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import {
  addressToScriptPubKey,
  p2wpkhAddressToHash160,
  hash256,
  DUST_THRESHOLD,
  hexToBytes,
  bytesToHex
} from './address.js';
import { bip122RpcGet, bip122Broadcast, getFeeRate } from './rpc.js';

const SIGHASH_ALL = 0x01;
const DEFAULT_SEQUENCE = 0xffffffff;
const TX_VERSION = 2;

/** compactSize / varint 编码。 */
function varint(n) {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0xfdn) return new Uint8Array([Number(v)]);
  if (v <= 0xffffn) return new Uint8Array([0xfd, Number(v & 0xffn), Number((v >> 8n) & 0xffn)]);
  if (v <= 0xffffffffn) {
    const out = new Uint8Array(5);
    out[0] = 0xfe;
    for (let i = 0; i < 4; i += 1) out[i + 1] = Number((v >> BigInt(8 * i)) & 0xffn);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0xff;
  for (let i = 0; i < 8; i += 1) out[i + 1] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}

/** u32 little-endian。 */
function u32LE(n) {
  const out = new Uint8Array(4);
  const v = Number(n) >>> 0;
  for (let i = 0; i < 4; i += 1) out[i] = (v >> (8 * i)) & 0xff;
  return out;
}

/** u64 little-endian（sat 金额）。 */
function u64LE(v) {
  const n = typeof v === 'bigint' ? v : BigInt(v);
  const out = new Uint8Array(8);
  let x = n;
  for (let i = 0; i < 8; i += 1) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** display-hex txid（大端）→ 内部字节序（reversed）。 */
function txidToInternal(txidHex) {
  const b = hexToBytes(txidHex);
  return b.reverse();
}

/**
 * 估算 P2WPKH 交易 vsize（用于 fee 预算）。
 * 约：非 witness (10.5 + 41*nIn + 31*nOut) + witness (1 + nIn*(1+72+1+33))/4
 * 简化取整：overhead 11 + inputs*68 + outputs*31。
 */
function estimateVsize(nIn, nOut) {
  return Math.ceil(11 + nIn * 68 + nOut * 31);
}

/**
 * greedy 选币（largest-first）。返回 { selected, total }，覆盖不了 target 抛错。
 * @param {Array<{txid:string,vout:number,value:number|string}>} utxos
 * @param {bigint} target amount + fee 预算
 */
function greedySelect(utxos, target) {
  const sorted = [...utxos].sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1));
  const selected = [];
  let total = 0n;
  for (const u of sorted) {
    selected.push(u);
    total += BigInt(u.value);
    if (total >= target) return { selected, total };
  }
  throw new Error(`Insufficient funds: need ${target} sat, have ${total} sat`);
}

/**
 * 构造未签名交易：拉 UTXO → 选币 → 计算 fee/找零 → 每输入生成 BIP-143 sighash。
 *
 * @param {import('../../types.d.ts').Intent} intent
 * @param {{chainKey:string}} ctx
 * @returns {Promise<import('../../types.d.ts').UnsignedTx>}
 */
export async function buildUnsigned(intent, ctx) {
  const { chainKey } = ctx;
  const from = String(intent.from || '').trim();
  const to = String(intent.to || '').trim();
  const amount = BigInt(/** @type {any} */(intent.amount));
  if (!from || !to) throw new Error('Bitcoin buildUnsigned: missing from/to');
  if (amount <= 0n) throw new Error('Bitcoin buildUnsigned: amount must be > 0');

  const feeRate = BigInt(/** @type {any} */(intent).feeRate || await getFeeRate(chainKey));
  const utxos = await bip122RpcGet(chainKey, `/address/${from}/utxo`);
  const usable = (Array.isArray(utxos) ? utxos : []).filter((u) => u && u.txid != null && u.vout != null);
  if (usable.length === 0) throw new Error('Bitcoin buildUnsigned: no spendable UTXO');

  const fromHash160 = p2wpkhAddressToHash160(from);
  const toScript = addressToScriptPubKey(to);
  const changeScript = addressToScriptPubKey(from);

  // 迭代选币：先按 2 输出估 fee，选够后决定是否留找零。
  let feeBudget = feeRate * BigInt(estimateVsize(1, 2));
  let picked = greedySelect(usable, amount + feeBudget);
  // 用实际输入数重算 fee
  feeBudget = feeRate * BigInt(estimateVsize(picked.selected.length, 2));
  if (picked.total < amount + feeBudget) {
    picked = greedySelect(usable, amount + feeBudget);
    feeBudget = feeRate * BigInt(estimateVsize(picked.selected.length, 2));
  }

  const outputs = [{ value: amount, script: toScript }];
  let change = picked.total - amount - feeBudget;
  if (change > DUST_THRESHOLD) {
    outputs.push({ value: change, script: changeScript });
  } else {
    // 找零太小 → 并入手续费，输出仅 1 个，fee 重算
    feeBudget = feeRate * BigInt(estimateVsize(picked.selected.length, 1));
    change = 0n;
  }

  const inputs = picked.selected.map((u) => ({
    txid: String(u.txid),
    vout: Number(u.vout),
    value: BigInt(u.value)
  }));

  // BIP-143 预计算：hashPrevouts / hashSequence / hashOutputs
  const prevouts = concat(inputs.map((i) => concat([txidToInternal(i.txid), u32LE(i.vout)])));
  const sequences = concat(inputs.map(() => u32LE(DEFAULT_SEQUENCE)));
  const outputsSer = concat(outputs.map((o) => concat([u64LE(o.value), varint(o.script.length), o.script])));
  const hashPrevouts = hash256(prevouts);
  const hashSequence = hash256(sequences);
  const hashOutputs = hash256(outputsSer);

  // scriptCode for P2WPKH = 0x1976a914{20B}88ac
  const scriptCode = concat([
    new Uint8Array([0x19, 0x76, 0xa9, 0x14]),
    fromHash160,
    new Uint8Array([0x88, 0xac])
  ]);

  const payloads = inputs.map((input) => {
    const preimage = concat([
      u32LE(TX_VERSION),
      hashPrevouts,
      hashSequence,
      txidToInternal(input.txid),
      u32LE(input.vout),
      scriptCode,
      u64LE(input.value),
      u32LE(DEFAULT_SEQUENCE),
      hashOutputs,
      u32LE(0), // nLocktime
      u32LE(SIGHASH_ALL)
    ]);
    const sighash = hash256(preimage);
    // sighash 已是 double-SHA256 的最终摘要；signer 直接对 bytes 签名（不再 hash），
    // hashAlg 仅信息性，取 'sha256'（SignPayload 类型不含 sha256d）。
    return /** @type {import('../../types.d.ts').SignPayload} */ ({
      kind: 'digest',
      bytes: `0x${bytesToHex(sighash)}`,
      hashAlg: 'sha256'
    });
  });

  return {
    curve: 'secp256k1',
    needsRecoveryId: false,
    payloads,
    serializeState: {
      chainKey,
      inputs,
      outputs,
      version: TX_VERSION,
      locktime: 0,
      fee: feeBudget.toString(),
      change: change.toString(),
      compressedPubkey: null // 由 signing-service 注入（witness 需要发送方公钥）
    }
  };
}

/**
 * r/s（0x…32B）→ DER 编码（minimal，含 low-s 归一化）。
 * @param {string} rHex
 * @param {string} sHex
 */
function toDer(rHex, sHex) {
  const encodeInt = (hex) => {
    let bytes = Array.from(hexToBytes(hex));
    // 去前导 0（但保留一个使高位为 0，避免被当负数）
    while (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) === 0) bytes.shift();
    if (bytes[0] & 0x80) bytes = [0x00, ...bytes];
    return [0x02, bytes.length, ...bytes];
  };
  const r = encodeInt(rHex);
  const s = encodeInt(sHex);
  const body = [...r, ...s];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/**
 * 组装已签名交易：填 witness，序列化成 segwit raw tx hex。
 * @param {import('../../types.d.ts').UnsignedTx} unsigned
 * @param {import('../../types.d.ts').SignatureResult} sig
 * @returns {string} raw tx hex（无 0x）
 */
export function assembleSigned(unsigned, sig) {
  const st = /** @type {any} */ (unsigned.serializeState);
  const inputs = st.inputs;
  const outputs = st.outputs;
  const parts = sig?.parts || [];
  if (parts.length !== inputs.length) {
    throw new Error(`Bitcoin assembleSigned: need ${inputs.length} signatures, got ${parts.length}`);
  }
  const pubkey = st.compressedPubkey;
  if (!(pubkey instanceof Uint8Array) || pubkey.length !== 33) {
    throw new Error('Bitcoin assembleSigned: missing compressed pubkey in serializeState');
  }

  // 非 witness 部分
  const inputsSer = concat(inputs.map((i) => concat([
    txidToInternal(i.txid),
    u32LE(i.vout),
    new Uint8Array([0x00]), // scriptSig 空（native segwit）
    u32LE(DEFAULT_SEQUENCE)
  ])));
  const outputsSer = concat(outputs.map((o) => concat([
    u64LE(o.value),
    varint(o.script.length),
    o.script
  ])));

  // witness：每输入 2 项 <sig+sighashtype> <pubkey>
  const witnessSer = concat(inputs.map((_, idx) => {
    const part = parts[idx];
    const der = toDer(part.r, part.s);
    const sigWithType = concat([der, new Uint8Array([SIGHASH_ALL])]);
    return concat([
      varint(2),
      varint(sigWithType.length), sigWithType,
      varint(pubkey.length), pubkey
    ]);
  }));

  const raw = concat([
    u32LE(st.version),
    new Uint8Array([0x00, 0x01]), // segwit marker + flag
    varint(inputs.length),
    inputsSer,
    varint(outputs.length),
    outputsSer,
    witnessSer,
    u32LE(st.locktime)
  ]);
  return bytesToHex(raw);
}

/**
 * 计算 txid（非 witness 序列化的 hash256，展示为大端 hex）。
 * @param {import('../../types.d.ts').UnsignedTx} unsigned
 */
export function computeTxid(unsigned) {
  const st = /** @type {any} */ (unsigned.serializeState);
  const inputs = st.inputs;
  const outputs = st.outputs;
  const inputsSer = concat(inputs.map((i) => concat([
    txidToInternal(i.txid), u32LE(i.vout), new Uint8Array([0x00]), u32LE(DEFAULT_SEQUENCE)
  ])));
  const outputsSer = concat(outputs.map((o) => concat([u64LE(o.value), varint(o.script.length), o.script])));
  const legacy = concat([
    u32LE(st.version), varint(inputs.length), inputsSer, varint(outputs.length), outputsSer, u32LE(st.locktime)
  ]);
  return bytesToHex(hash256(legacy).reverse());
}

/**
 * 广播 raw tx hex，返回 txid。
 * @param {string} rawTxHex
 * @param {{chainKey:string}} ctx
 * @returns {Promise<string>}
 */
export async function broadcast(rawTxHex, ctx) {
  return bip122Broadcast(ctx.chainKey, rawTxHex);
}

// 供测试 / 上层使用
export { toDer, greedySelect, estimateVsize };
