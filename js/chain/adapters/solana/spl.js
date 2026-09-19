// @ts-check
/**
 * SPL Token 辅助（手写，零 npm 依赖）
 *
 * 范围（Phase 3）：
 *   - Program ID 常量：SPL Token Program / Associated Token Account Program
 *   - findProgramAddress（PDA 派生，含 ed25519 off-curve 校验）
 *   - getAssociatedTokenAddress（owner + mint → ATA）
 *   - splTransferCheckedInstruction（TransferChecked，指令 tag=12）
 *
 * 不含：createAssociatedTokenAccount（v1 假设收款方 ATA 已存在）、
 * multisig、TransferChecked 之外的 SPL 指令。
 *
 * PDA 参考：https://solana.com/docs/core/pda
 * off-curve 校验用 BigInt 直接做 ed25519 域算术（p = 2^255-19），
 * 不依赖 tweetnacl 内部 lowlevel（其未导出点解压）。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import { base58Decode } from '../../../../lib/base58.js';
import { concatBytes, u64LE } from './sysprog.js';

// SPL Token Program：TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
export const TOKEN_PROGRAM_ID = base58Decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
// Associated Token Account Program：ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
export const ASSOCIATED_TOKEN_PROGRAM_ID = base58Decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

// ed25519 域参数
const ED25519_P = (1n << 255n) - 19n;

/**
 * mod（结果落 [0, m)）
 * @param {bigint} a
 * @param {bigint} m
 * @returns {bigint}
 */
function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/**
 * 模幂 base^exp mod m
 * @param {bigint} base
 * @param {bigint} exp
 * @param {bigint} m
 * @returns {bigint}
 */
function powmod(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

// d = -121665 / 121666 mod p
const ED25519_D = mod(-121665n * powmod(121666n, ED25519_P - 2n, ED25519_P), ED25519_P);

/**
 * 判断 32 字节压缩点是否落在 ed25519 曲线上。
 * 落在曲线上 → 不可作 PDA；off-curve → 合法 PDA。
 * @param {Uint8Array} bytes 32 字节（little-endian y，最高位为 x 符号）
 * @returns {boolean}
 */
export function isOnCurveEd25519(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  // little-endian → bigint
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n; // 清掉 x 符号位
  y = mod(y, ED25519_P);
  const y2 = mod(y * y, ED25519_P);
  const u = mod(y2 - 1n, ED25519_P);
  const v = mod(ED25519_D * y2 + 1n, ED25519_P);
  // x = (u * v^3) * (u * v^7)^((p-5)/8)
  const v3 = mod(v * v % ED25519_P * v, ED25519_P);
  const v7 = mod(v3 * v3 % ED25519_P * v, ED25519_P);
  const x = mod(u * v3 % ED25519_P * powmod(mod(u * v7, ED25519_P), (ED25519_P - 5n) / 8n, ED25519_P), ED25519_P);
  const vx2 = mod(v * x % ED25519_P * x, ED25519_P);
  // vx² == u（有平方根）或 vx² == -u（乘 sqrt(-1) 后有解）→ 在曲线上
  if (vx2 === u) return true;
  if (vx2 === mod(-u, ED25519_P)) return true;
  return false;
}

/**
 * findProgramAddress：从 bump=255 递减找到第一个 off-curve 结果。
 * @param {Uint8Array[]} seeds
 * @param {Uint8Array} programId 32 字节
 * @returns {{ address: Uint8Array, bump: number }}
 */
export function findProgramAddress(seeds, programId) {
  for (const s of seeds) {
    if (!(s instanceof Uint8Array) || s.length > 32) {
      throw new Error('findProgramAddress: each seed must be ≤ 32 bytes');
    }
  }
  for (let bump = 255; bump >= 0; bump--) {
    const preimage = concatBytes([
      ...seeds,
      new Uint8Array([bump]),
      programId,
      PDA_MARKER
    ]);
    const hashHex = ethers.sha256(preimage);
    const hash = ethers.getBytes(hashHex);
    if (!isOnCurveEd25519(hash)) {
      return { address: hash, bump };
    }
  }
  throw new Error('findProgramAddress: unable to find a viable bump');
}

/**
 * 派生 owner + mint 对应的 Associated Token Account 地址。
 * seeds = [owner, TOKEN_PROGRAM_ID, mint]，program = ASSOCIATED_TOKEN_PROGRAM_ID。
 * @param {Uint8Array} ownerPubkey 32 字节
 * @param {Uint8Array} mintPubkey 32 字节
 * @returns {Uint8Array} ATA 地址 32 字节
 */
export function getAssociatedTokenAddress(ownerPubkey, mintPubkey) {
  if (!(ownerPubkey instanceof Uint8Array) || ownerPubkey.length !== 32) {
    throw new Error('getAssociatedTokenAddress: owner must be 32 bytes');
  }
  if (!(mintPubkey instanceof Uint8Array) || mintPubkey.length !== 32) {
    throw new Error('getAssociatedTokenAddress: mint must be 32 bytes');
  }
  return findProgramAddress([ownerPubkey, TOKEN_PROGRAM_ID, mintPubkey], ASSOCIATED_TOKEN_PROGRAM_ID).address;
}

/**
 * SPL Token TransferChecked 指令（tag=12）。
 *   accounts: [source ATA(w), mint(r), destination ATA(w), owner(signer,r)]
 *   data: [12] || u64 amount(LE) || u8 decimals  → 共 10 字节
 * @param {{ source: Uint8Array, mint: Uint8Array, destination: Uint8Array, owner: Uint8Array, amount: bigint|string|number, decimals: number }} args
 * @returns {{ programId: Uint8Array, keys: Array<{pubkey: Uint8Array, isSigner: boolean, isWritable: boolean}>, data: Uint8Array }}
 */
export function splTransferCheckedInstruction({ source, mint, destination, owner, amount, decimals }) {
  for (const [name, v] of [['source', source], ['mint', mint], ['destination', destination], ['owner', owner]]) {
    if (!(v instanceof Uint8Array) || v.length !== 32) {
      throw new Error(`splTransferChecked: ${name} must be 32 bytes`);
    }
  }
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 255) {
    throw new Error(`splTransferChecked: invalid decimals ${decimals}`);
  }
  const amt = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (amt <= 0n) throw new Error('splTransferChecked: amount must be positive');
  const data = concatBytes([new Uint8Array([12]), u64LE(amt), new Uint8Array([dec])]);
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  };
}
