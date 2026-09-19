// @ts-check
/**
 * Solana wire-format helpers（手写，零依赖；不下 @solana/web3.js）
 *
 * 范围：仅支持 v1 native SOL transfer + 单 signer message。
 *   - Compact-u16：Solana 二进制 wire 编码（最高 3 字节，最高位续位标志）
 *   - Transaction / Message：原 message → 已签名 wire bytes
 *   - SystemProgram.transfer：构造原生 SOL 转账指令（12 字节 data：
 *       [2, 0, 0, 0] || u64 little-endian lamports）
 *
 * 不包含：
 *   - Versioned transactions（v0 / v0+lookup table）
 *   - Address lookup tables
 *   - SPL Token 转账（Phase 3 走）
 *   - Borsh / bincode（Solana 自家序列化）
 *
 * Solana wire 文档：
 *   https://docs.solana.com/terminology#transaction-format
 *   https://github.com/solana-labs/solana/blob/master/sdk/src/transaction/sanitized.rs
 */

const SYSTEM_PROGRAM_ID_BYTES = new Uint8Array(32); // 32 个 0 = SystemProgram
const RECENT_BLOCKHASH_LEN = 32;
const PUBKEY_LEN = 32;
const SIGNATURE_LEN = 64;

/**
 * Compact-u16 编码（Solana 变长整数）
 *   < 0x80:            1 字节
 *   < 0x4000:          2 字节 (low 7 bits | 0x80, then next 7 bits)
 *   < 0x200000:        3 字节
 * @param {number} n 非负整数，≤ 0x1fffff
 * @returns {Uint8Array}
 */
export function encodeCompactU16(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`compact-u16: invalid n=${n}`);
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x4000) return new Uint8Array([(n & 0x7f) | 0x80, (n >> 7) & 0x7f]);
  if (n < 0x200000) return new Uint8Array([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, (n >> 14) & 0x03]);
  throw new Error(`compact-u16: n=${n} too large`);
}

/**
 * 计算 compact-u16 编码长度（不分配 buffer）
 * @param {number} n
 * @returns {number}
 */
export function compactU16Length(n) {
  if (n < 0x80) return 1;
  if (n < 0x4000) return 2;
  return 3;
}

/**
 * 把多个 Uint8Array 顺序拼到一个新 buffer。
 * @param {ReadonlyArray<Uint8Array>} parts
 * @returns {Uint8Array}
 */
export function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * 把 u64 little-endian 写到一个 8 字节 buffer。
 * @param {bigint|number} v
 * @returns {Uint8Array}
 */
export function u64LE(v) {
  const n = typeof v === 'bigint' ? v : BigInt(v);
  if (n < 0n) throw new Error(`u64LE: negative ${n}`);
  const out = new Uint8Array(8);
  let x = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * Solana SystemProgram：构造 transfer 指令（原生 SOL 转账）
 *   data: [2, 0, 0, 0] (4 字节 tag) || u64 lamports (8B LE)  → 共 12 字节
 *   keys: [from, to]（from 是 signer-writable，to 是 writable）
 *
 * @param {{ fromPubkey: Uint8Array, toPubkey: Uint8Array, lamports: bigint|number }} args
 * @returns {{ programId: Uint8Array, keys: Array<{pubkey: Uint8Array, isSigner: boolean, isWritable: boolean}>, data: Uint8Array }}
 */
export function systemTransferInstruction({ fromPubkey, toPubkey, lamports }) {
  if (!(fromPubkey instanceof Uint8Array) || fromPubkey.length !== PUBKEY_LEN) {
    throw new Error('systemTransfer: fromPubkey must be 32 bytes');
  }
  if (!(toPubkey instanceof Uint8Array) || toPubkey.length !== PUBKEY_LEN) {
    throw new Error('systemTransfer: toPubkey must be 32 bytes');
  }
  const tag = new Uint8Array([2, 0, 0, 0]);
  const data = concatBytes([tag, u64LE(lamports)]);
  return {
    programId: SYSTEM_PROGRAM_ID_BYTES,
    keys: [
      { pubkey: fromPubkey, isSigner: true,  isWritable: true  },
      { pubkey: toPubkey,   isSigner: false, isWritable: true  }
    ],
    data
  };
}

/**
 * Solana Message（原版未 versioned 消息）
 *   layout:
 *     [0] num_required_signatures  (1B)
 *     [1] num_readonly_signed      (1B) —— 只读但已签名的账户数
 *     [2] num_readonly_unsigned    (1B) —— 未签名且只读的账户数
 *     compact-u16 header_accounts_count
 *     header_accounts_count × 32B pubkeys
 *     32B recent_blockhash
 *     compact-u16 instructions_count
 *     per instruction:
 *       1B program_id_index
 *       compact-u16 accounts_count
 *       accounts_count × 1B (account index in header)
 *       compact-u16 data_len
 *       data_len bytes
 *
 * @param {{ feePayer: Uint8Array, recentBlockhash: Uint8Array, instructions: Array<ReturnType<typeof systemTransferInstruction>> }} cfg
 */
export class Message {
  constructor(cfg) {
    if (!(cfg.feePayer instanceof Uint8Array) || cfg.feePayer.length !== PUBKEY_LEN) {
      throw new Error('Message: feePayer must be 32 bytes');
    }
    if (!(cfg.recentBlockhash instanceof Uint8Array) || cfg.recentBlockhash.length !== RECENT_BLOCKHASH_LEN) {
      throw new Error('Message: recentBlockhash must be 32 bytes');
    }
    this.feePayer = cfg.feePayer;
    this.recentBlockhash = cfg.recentBlockhash;
    this.instructions = cfg.instructions || [];

    // 收集 header：signers + writable + readonly 排序
    // Solana header 顺序：完全 signer-writable 在前；只读 signer 接着；writable unsigned 接着；readonly unsigned 最后
    // 我们只支持单 signer 简化版：header = [feePayer, ...instruction.keys (非 feePayer 的, 去重), ...programIds (去重)]
    const headerSet = new Set();
    const headerKeys = [];
    const addToHeader = (k) => {
      const hex = pubkeyHex(k);
      if (!headerSet.has(hex)) {
        headerSet.add(hex);
        headerKeys.push(k);
      }
    };
    addToHeader(this.feePayer);
    for (const ix of this.instructions) {
      for (const k of ix.keys) addToHeader(k.pubkey);
    }
    for (const ix of this.instructions) addToHeader(ix.programId);
    this.headerKeys = headerKeys;
    this.numRequiredSignatures = 1;  // 单 signer
    this.numReadonlySigned = 0;
    this.numReadonlyUnsigned = 0;   // 由 serializeMessage 修正
  }

  /**
   * 序列化为 message bytes（给 sign / broadcast 用）
   * @returns {Uint8Array}
   */
  serializeMessage() {
    // 决定 numReadonlyUnsigned：最后一个 header key（程序 ID）算 readonly unsigned
    // Solana 算法：feePayer 是 signer+writable；program IDs 默认 readonly unsigned
    // 简化：所有非 feePayer 的 keys 标记 writable；最后一个 programId 算 readonly
    let numReadonlyUnsigned = 0;
    for (const ix of this.instructions) {
      // 每个 ix 的 programId 是 readonly unsigned（除非它是 feePayer，但 SystemProgram != feePayer）
      // 已在 headerKeys 里；它在末尾
    }
    // 计算 readonly unsigned：出现在 header 但只是 programId 角色的
    const programIds = new Set();
    for (const ix of this.instructions) {
      programIds.add(pubkeyHex(ix.programId));
    }
    // 任何 programId 出现在 headerKeys 中（除了 feePayer）算 readonly unsigned
    let readonlyUnsignedCount = 0;
    for (let i = 1; i < this.headerKeys.length; i++) {
      if (programIds.has(pubkeyHex(this.headerKeys[i]))) {
        readonlyUnsignedCount++;
      }
    }
    this.numReadonlyUnsigned = readonlyUnsignedCount;

    const headerKeysBytes = concatBytes(this.headerKeys);
    const encHeaderCount = encodeCompactU16(this.headerKeys.length);
    const encInstrCount = encodeCompactU16(this.instructions.length);

    // account index map
    const keyIndex = new Map();
    this.headerKeys.forEach((k, i) => keyIndex.set(pubkeyHex(k), i));

    const ixBuffers = this.instructions.map((ix) => {
      const progIdx = keyIndex.get(pubkeyHex(ix.programId));
      if (progIdx === undefined) throw new Error('Message: programId not in header');
      const accountIdxs = ix.keys.map((k) => {
        const idx = keyIndex.get(pubkeyHex(k.pubkey));
        if (idx === undefined) throw new Error('Message: account not in header');
        return idx;
      });
      const encAccountIdxs = encodeCompactU16(accountIdxs.length);
      const accountIdxBytes = new Uint8Array(accountIdxs);
      const encDataLen = encodeCompactU16(ix.data.length);
      return concatBytes([
        new Uint8Array([progIdx]),
        encAccountIdxs,
        accountIdxBytes,
        encDataLen,
        ix.data
      ]);
    });

    return concatBytes([
      new Uint8Array([this.numRequiredSignatures, this.numReadonlySigned, this.numReadonlyUnsigned]),
      encHeaderCount,
      headerKeysBytes,
      this.recentBlockhash,
      encInstrCount,
      ...ixBuffers
    ]);
  }
}

/**
 * Solana Transaction（带 1 个 signer 的 message + signatures）
 */
export class Transaction {
  /**
   * @param {{ feePayer: Uint8Array, recentBlockhash: Uint8Array }} cfg
   */
  constructor(cfg) {
    this.message = new Message({
      feePayer: cfg.feePayer,
      recentBlockhash: cfg.recentBlockhash,
      instructions: []
    });
    /** @type {Map<string, Uint8Array>} */
    this.signatures = new Map();
  }

  /**
   * @param {ReturnType<typeof systemTransferInstruction>} ix
   */
  add(ix) {
    this.message.instructions.push(ix);
    // 同步把 ix 的 accounts + programId 加进 header（v1：单 signer 简化）
    const headerSet = new Set(this.message.headerKeys.map(pubkeyHex));
    const addToHeader = (k) => {
      const hex = pubkeyHex(k);
      if (!headerSet.has(hex)) {
        headerSet.add(hex);
        this.message.headerKeys.push(k);
      }
    };
    for (const k of ix.keys) addToHeader(k.pubkey);
    addToHeader(ix.programId);
  }

  /**
   * 给 feePayer 加签（64 字节 ed25519 signature）
   * @param {Uint8Array} feePayer 32 字节 pubkey
   * @param {Uint8Array} signature 64 字节 ed25519 signature
   */
  addSignature(feePayer, signature) {
    if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LEN) {
      throw new Error('Transaction.addSignature: signature must be 64 bytes');
    }
    this.signatures.set(pubkeyHex(feePayer), signature);
  }

  /**
   * 序列化带签名的完整 wire transaction bytes
   *   layout: compact-u16 signatures_count || signatures_count × 64B || message_bytes
   * @returns {Uint8Array}
   */
  serialize() {
    const sigs = Array.from(this.signatures.values());
    if (sigs.length !== this.message.numRequiredSignatures) {
      throw new Error(`Transaction.serialize: need ${this.message.numRequiredSignatures} signatures, got ${sigs.length}`);
    }
    const encSigCount = encodeCompactU16(sigs.length);
    const sigBytes = concatBytes(sigs);
    const messageBytes = this.message.serializeMessage();
    return concatBytes([encSigCount, sigBytes, messageBytes]);
  }
}

function pubkeyHex(pubkey) {
  // 用前 8 字节作 Set key（避免每个 key 都 hex 全 64B）
  let s = '';
  for (let i = 0; i < 8; i++) s += pubkey[i].toString(16).padStart(2, '0');
  return s + ':' + pubkey.length;
}

// 暴露给上层使用
export const SOLANA_CONSTANTS = {
  PUBKEY_LEN,
  RECENT_BLOCKHASH_LEN,
  SIGNATURE_LEN,
  SYSTEM_PROGRAM_ID: SYSTEM_PROGRAM_ID_BYTES
};