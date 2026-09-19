/**
 * js/chain/adapters/solana 单元测试（依赖 vendored tweetnacl，零 DOM）
 *
 * 守门点：
 *   - buildUnsigned / assembleSigned 形（curve=ed25519、kind=message、hashAlg=null）
 *   - SystemProgram.transfer 序列化长度稳定（与 SOL wire format 匹配）
 *   - ed25519 签 message 全字节，sig 64B，base58 编码回原字节
 *   - broadcast 走 JSON-RPC sendTransaction，返 base58 txid
 *
 * Phase 1 不覆盖：MPC 路径、SPL token、ATA 创建（Phase 3）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import nacl from '../lib/nacl.js';
import { base58Decode, base58Encode } from '../lib/base58.js';
import {
  buildUnsigned,
  assembleSigned,
  signEd25519Message
} from '../js/chain/adapters/solana/transaction.js';
import { Transaction, systemTransferInstruction, encodeCompactU16 } from '../js/chain/adapters/solana/sysprog.js';
import { solanaAdapter } from '../js/chain/adapters/solana/index.js';
import {
  isOnCurveEd25519,
  getAssociatedTokenAddress,
  splTransferCheckedInstruction,
  TOKEN_PROGRAM_ID
} from '../js/chain/adapters/solana/spl.js';
import { solanaAddressToPubkey } from '../js/chain/adapters/solana/address.js';

// 固定测试密钥对（base58 地址 = 5kMDkdera2vkpd3XkjMd851WJ4EnE9nxGcukW2mW7AU3，对应
// Hardhat account #0 私钥字节复用为 ed25519 seed——与 popup-import-solana spec 同源）。
const FROM_PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const FROM_HEX_PRIV = '0x' + FROM_PRIV_HEX;
const FROM_KEYPAIR = nacl.sign.keyPair.fromSeed(new Uint8Array(32));
{
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = parseInt(FROM_PRIV_HEX.slice(i * 2, i * 2 + 2), 16);
  // 重写 seed 以确保私钥字节与 Hardhat 一致
  var FROM_SEED = seed;
  var FROM_KP = nacl.sign.keyPair.fromSeed(FROM_SEED);
}
// 任一有效 base58 地址（32 字节任意 ed25519 pubkey）
const TO_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const FROM_ADDR = base58Encode(FROM_KP.publicKey);

// ===== encodeCompactU16 =====

test('encodeCompactU16：1 字节 (n<0x80) / 2 字节 (n<0x4000) / 3 字节 (n<0x200000)', () => {
  // 0 → [0]
  assert.equal(encodeCompactU16(0).length, 1);
  // 0x7f → [0x7f]
  assert.equal(encodeCompactU16(0x7f).length, 1);
  // 0x80 → [0x80, 0x01]
  assert.equal(encodeCompactU16(0x80).length, 2);
  // 0x3fff → [0xff, 0x7f]
  assert.equal(encodeCompactU16(0x3fff).length, 2);
  // 0x4000 → [0x80, 0x80, 0x01]
  assert.equal(encodeCompactU16(0x4000).length, 3);
  // 0x1ffff → [0xff, 0xff, 0x03]
  assert.equal(encodeCompactU16(0x1ffff).length, 3);
});

// ===== SystemProgram.transfer =====

test('SystemProgram.transfer：data = 4B tag + 8B lamports LE', () => {
  const ix = systemTransferInstruction({
    fromPubkey: new Uint8Array(32),
    toPubkey: new Uint8Array(32),
    lamports: 1000n
  });
  assert.equal(ix.programId.length, 32);
  assert.equal(ix.keys.length, 2);
  // data = 4B tag + 8B u64 LE lamports = 12 bytes
  assert.equal(ix.data.length, 12);
  // tag = [2, 0, 0, 0]
  assert.equal(ix.data[0], 2);
  assert.equal(ix.data[1], 0);
  assert.equal(ix.data[2], 0);
  assert.equal(ix.data[3], 0);
  // lamports LE: 1000 = 0x3e8 → low byte 0xe8, second byte 0x03
  assert.equal(ix.data[4], 0xe8);
  assert.equal(ix.data[5], 0x03);
  for (let i = 6; i < 12; i++) assert.equal(ix.data[i], 0);
});

// ===== Transaction.serializeMessage + serialize =====

test('Transaction：1 signer / 1 transfer / 32B blockhash → message 头 + accounts + 1 ix', () => {
  const feePayer = FROM_KP.publicKey;
  const blockhash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) blockhash[i] = i;
  // 给 toPubkey 一个非全 0 的 32B 数组；SystemProgram ID 全 0，pubkeyHex
  // 不能因字节相同而把 toPubkey/programId 合并（Solana header 按 slot 排，
  // 同字节也得各占一位）。这里用 [0xFF, 0xFF, ...] 避免与 programId 冲突，
  // 真实场景 toPubkey 总是非全 0。
  const toPubkey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) toPubkey[i] = 0xff - i;
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash });
  tx.add(systemTransferInstruction({
    fromPubkey: feePayer,
    toPubkey,
    lamports: 1_000_000_000n
  }));
  const msg = tx.message.serializeMessage();
  // layout: 3B header + compact-u16(accounts) + N×32B pubkeys + 32B blockhash
  //        + compact-u16(ix_count) + per-ix (1B program_idx + compact-u16(acct_idx)
  //        + idx_bytes + compact-u16(data_len) + data_len bytes)
  // feePayer + toPubkey + programId = 3 pubkeys；ix: 1B programId + 1B acct_count
  // + 2B acct_idx + 1B data_len + 12B data = 17B
  // header (3) + compact-u16(3) (1) + 3*32 (96) + 32 (blockhash) + compact-u16(1) (1) + 17 = 150
  const expected = 3 + 1 + 3 * 32 + 32 + 1 + 1 + 1 + 2 + 1 + 12;
  assert.equal(msg.length, expected);

  const sig = new Uint8Array(64);
  // 模拟签名填充：64B 全零（仅占位）
  tx.addSignature(feePayer, sig);
  const wire = tx.serialize();
  // compact-u16(sig_count=1) + 64 (sig) + message_bytes
  assert.equal(wire.length, 1 + 64 + msg.length);
});

// ===== buildUnsigned / assembleSigned 形 =====

test('buildUnsigned：native-transfer → curve=ed25519 / kind=message / hashAlg=null', async () => {
  // stub rpc：getRecentBlockhash → 固定 blockhash
  const blockhash32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) blockhash32[i] = i;
  const blockhash = base58Encode(blockhash32);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 'x',
      result: { context: { slot: 1 }, value: { blockhash, feeCalculator: { lamportsPerSignature: 5000 } } }
    })
  });
  try {
    const u = await buildUnsigned(
      { type: 'native-transfer', from: FROM_ADDR, to: TO_ADDR, amount: '1000000' },
      { chainKey: 'solana:mainnet-beta' }
    );
    assert.equal(u.curve, 'ed25519');
    assert.equal(u.needsRecoveryId, false);
    assert.equal(u.payloads.length, 1);
    assert.equal(u.payloads[0].kind, 'message');
    assert.equal(u.payloads[0].hashAlg, null);
    assert.equal(u.payloads[0].bytes.startsWith('0x'), true);
    // serializeState 携带 tx / feePayer / messageBytes
    assert.equal(u.serializeState.chainKey, 'solana:mainnet-beta');
    assert.ok(u.serializeState.messageBytes instanceof Uint8Array);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('assembleSigned：base58(sig) → base58(wire)，embedded message 一致', async () => {
  // 同上 stub
  const blockhash32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) blockhash32[i] = i;
  const blockhash = base58Encode(blockhash32);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 'x',
      result: { context: { slot: 1 }, value: { blockhash, feeCalculator: { lamportsPerSignature: 5000 } } }
    })
  });
  try {
    const u = await buildUnsigned(
      { type: 'native-transfer', from: FROM_ADDR, to: TO_ADDR, amount: '1000000' },
      { chainKey: 'solana:mainnet-beta' }
    );
    const sig = base58Encode(new Uint8Array(64));
    const wire = assembleSigned(u, { parts: [{ signature: sig }] });
    // base58(wire) → 解码回字节应 ≥ message + 1 + 64
    const wireBytes = base58Decode(wire);
    const messageBytes = /** @type {Uint8Array} */ (u.serializeState.messageBytes);
    assert.ok(wireBytes.length >= 1 + 64 + messageBytes.length);
    // wire 末尾 = message bytes（assembleSigned 内部 verify）
    const tail = wireBytes.slice(wireBytes.length - messageBytes.length);
    assert.deepEqual(Array.from(tail), Array.from(messageBytes));
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ===== signEd25519Message =====

test('signEd25519Message：detached sign 64B，nacl.sign.detached 验证回原 message', () => {
  const msg = new TextEncoder().encode('hello solana');
  const sigB58 = signEd25519Message(msg, FROM_KP.secretKey);
  const sigBytes = base58Decode(sigB58);
  assert.equal(sigBytes.length, 64);
  // 用 nacl 验证签名（真签）
  assert.equal(nacl.sign.detached.verify(msg, sigBytes, FROM_KP.publicKey), true);
  // 改一个字节，验证失败
  const tampered = new Uint8Array(msg);
  tampered[0] = tampered[0] ^ 0xff;
  assert.equal(nacl.sign.detached.verify(tampered, sigBytes, FROM_KP.publicKey), false);
});

// ===== solanaAdapter 形 =====

test('solanaAdapter：namespace / family / curve / coinType / chainKey', () => {
  assert.equal(solanaAdapter.namespace, 'solana');
  assert.equal(solanaAdapter.family, 'solana');
  assert.equal(solanaAdapter.curve, 'ed25519');
  assert.equal(solanaAdapter.coinType, 501);
  assert.equal(typeof solanaAdapter.chainKey, 'function');
  assert.equal(typeof solanaAdapter.buildUnsigned, 'function');
  assert.equal(typeof solanaAdapter.assembleSigned, 'function');
  assert.equal(typeof solanaAdapter.broadcast, 'function');
  assert.equal(typeof solanaAdapter.getNativeBalance, 'function');
});

test('solanaAdapter.chainKey：{ reference: "mainnet-beta" } → "solana:mainnet-beta"', () => {
  assert.equal(solanaAdapter.chainKey({ reference: 'mainnet-beta' }), 'solana:mainnet-beta');
  assert.equal(solanaAdapter.chainKey({ reference: 'devnet' }), 'solana:devnet');
  assert.equal(solanaAdapter.chainKey({ reference: 'testnet' }), 'solana:testnet');
  // 默认回 mainnet-beta
  assert.equal(solanaAdapter.chainKey({}), 'solana:mainnet-beta');
});

// ===== getTokenBalance（SPL） =====

test('getTokenBalance：getTokenAccountsByOwner 累加 tokenAmount.amount', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 'x',
      result: {
        context: { slot: 1 },
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { amount: '1500000' } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { amount: '500000' } } } } } }
        ]
      }
    })
  });
  try {
    const r = await solanaAdapter.getTokenBalance(
      FROM_ADDR,
      { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { chainKey: 'solana:mainnet-beta' }
    );
    // 1500000 + 500000 = 2000000
    assert.equal(r.balance, '2000000');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getTokenBalance：无 token account → 0', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 'x', result: { context: { slot: 1 }, value: [] } })
  });
  try {
    const r = await solanaAdapter.getTokenBalance(
      FROM_ADDR,
      { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { chainKey: 'solana:mainnet-beta' }
    );
    assert.equal(r.balance, '0');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getTokenBalance：缺 owner/mint 抛错', async () => {
  await assert.rejects(
    () => solanaAdapter.getTokenBalance('', { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }, { chainKey: 'solana:mainnet-beta' }),
    /owner and mint required/
  );
  await assert.rejects(
    () => solanaAdapter.getTokenBalance(FROM_ADDR, { address: '' }, { chainKey: 'solana:mainnet-beta' }),
    /owner and mint required/
  );
});

// ===== SPL：isOnCurveEd25519 =====

test('isOnCurveEd25519：真 ed25519 pubkey → true（多把随机密钥）', () => {
  for (let i = 0; i < 5; i++) {
    const kp = nacl.sign.keyPair();
    assert.equal(isOnCurveEd25519(kp.publicKey), true, `keypair #${i} pubkey 应在曲线上`);
  }
  // 固定测试 pubkey 也在曲线上
  assert.equal(isOnCurveEd25519(FROM_KP.publicKey), true);
});

test('isOnCurveEd25519：非 32 字节 → false', () => {
  assert.equal(isOnCurveEd25519(new Uint8Array(31)), false);
  assert.equal(isOnCurveEd25519(new Uint8Array(33)), false);
  assert.equal(isOnCurveEd25519(/** @type {any} */ ('not bytes')), false);
});

test('isOnCurveEd25519：ATA（PDA，off-curve）→ false', () => {
  // ATA 由 findProgramAddress 派生，保证 off-curve；isOnCurve 必须拒绝它，
  // 否则 findProgramAddress 会误判 bump。
  const mint = solanaAddressToPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const ata = getAssociatedTokenAddress(FROM_KP.publicKey, mint);
  assert.equal(ata.length, 32);
  assert.equal(isOnCurveEd25519(ata), false);
});

// ===== SPL：getAssociatedTokenAddress =====

test('getAssociatedTokenAddress：确定性（同 owner+mint → 同 ATA）', () => {
  const mint = solanaAddressToPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const a1 = getAssociatedTokenAddress(FROM_KP.publicKey, mint);
  const a2 = getAssociatedTokenAddress(FROM_KP.publicKey, mint);
  assert.deepEqual(Array.from(a1), Array.from(a2));
});

test('getAssociatedTokenAddress：不同 owner → 不同 ATA', () => {
  const mint = solanaAddressToPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const owner2 = solanaAddressToPubkey(TO_ADDR);
  const a1 = getAssociatedTokenAddress(FROM_KP.publicKey, mint);
  const a2 = getAssociatedTokenAddress(owner2, mint);
  assert.notDeepEqual(Array.from(a1), Array.from(a2));
});

test('getAssociatedTokenAddress：不同 mint → 不同 ATA', () => {
  const mintA = solanaAddressToPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const mintB = solanaAddressToPubkey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  const a1 = getAssociatedTokenAddress(FROM_KP.publicKey, mintA);
  const a2 = getAssociatedTokenAddress(FROM_KP.publicKey, mintB);
  assert.notDeepEqual(Array.from(a1), Array.from(a2));
});

test('getAssociatedTokenAddress：owner/mint 非 32 字节 → 抛错', () => {
  const mint = solanaAddressToPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.throws(() => getAssociatedTokenAddress(new Uint8Array(31), mint), /owner must be 32 bytes/);
  assert.throws(() => getAssociatedTokenAddress(FROM_KP.publicKey, new Uint8Array(10)), /mint must be 32 bytes/);
});

// ===== SPL：splTransferCheckedInstruction =====

test('splTransferCheckedInstruction：data = [12] || u64 amount LE || u8 decimals', () => {
  const source = new Uint8Array(32).fill(1);
  const mint = new Uint8Array(32).fill(2);
  const destination = new Uint8Array(32).fill(3);
  const owner = new Uint8Array(32).fill(4);
  const ix = splTransferCheckedInstruction({
    source, mint, destination, owner,
    amount: 1_000_000n, // 1 USDC (6 decimals)
    decimals: 6
  });
  // programId = SPL Token Program
  assert.deepEqual(Array.from(ix.programId), Array.from(TOKEN_PROGRAM_ID));
  // data 长度 = 1 (tag) + 8 (u64) + 1 (decimals) = 10
  assert.equal(ix.data.length, 10);
  // tag = 12 (TransferChecked)
  assert.equal(ix.data[0], 12);
  // 1_000_000 = 0x0F4240 → LE 低字节 0x40, 0x42, 0x0f
  assert.equal(ix.data[1], 0x40);
  assert.equal(ix.data[2], 0x42);
  assert.equal(ix.data[3], 0x0f);
  for (let i = 4; i < 9; i++) assert.equal(ix.data[i], 0);
  // decimals 尾字节
  assert.equal(ix.data[9], 6);
});

test('splTransferCheckedInstruction：accounts 顺序与 signer/writable 标记', () => {
  const source = new Uint8Array(32).fill(1);
  const mint = new Uint8Array(32).fill(2);
  const destination = new Uint8Array(32).fill(3);
  const owner = new Uint8Array(32).fill(4);
  const ix = splTransferCheckedInstruction({ source, mint, destination, owner, amount: 5n, decimals: 6 });
  assert.equal(ix.keys.length, 4);
  // [source ATA(w), mint(r), destination ATA(w), owner(signer,r)]
  assert.deepEqual(ix.keys[0], { pubkey: source, isSigner: false, isWritable: true });
  assert.deepEqual(ix.keys[1], { pubkey: mint, isSigner: false, isWritable: false });
  assert.deepEqual(ix.keys[2], { pubkey: destination, isSigner: false, isWritable: true });
  assert.deepEqual(ix.keys[3], { pubkey: owner, isSigner: true, isWritable: false });
});

test('splTransferCheckedInstruction：amount<=0 / decimals 非法 → 抛错', () => {
  const p = new Uint8Array(32);
  assert.throws(() => splTransferCheckedInstruction({ source: p, mint: p, destination: p, owner: p, amount: 0n, decimals: 6 }), /amount must be positive/);
  assert.throws(() => splTransferCheckedInstruction({ source: p, mint: p, destination: p, owner: p, amount: 1n, decimals: 256 }), /invalid decimals/);
});

// ===== SPL：buildSplTokenTransfer（token-transfer 分支） =====

test('buildSplTokenTransfer：token-transfer → curve=ed25519 / message / hashAlg=null', async () => {
  const blockhash32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) blockhash32[i] = i;
  const blockhash = base58Encode(blockhash32);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 'x',
      result: { context: { slot: 1 }, value: { blockhash, feeCalculator: { lamportsPerSignature: 5000 } } }
    })
  });
  try {
    const u = await buildUnsigned(
      {
        type: 'token-transfer',
        from: FROM_ADDR,
        to: TO_ADDR,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        decimals: 6
      },
      { chainKey: 'solana:mainnet-beta' }
    );
    assert.equal(u.curve, 'ed25519');
    assert.equal(u.needsRecoveryId, false);
    assert.equal(u.payloads.length, 1);
    assert.equal(u.payloads[0].kind, 'message');
    assert.equal(u.payloads[0].hashAlg, null);
    assert.equal(u.payloads[0].bytes.startsWith('0x'), true);
    assert.ok(u.serializeState.messageBytes instanceof Uint8Array);
    // SPL 转账 message 头：feePayer(WS) + owner=feePayer 合并；
    // header accounts = feePayer + sourceATA + mint + destATA + TOKEN_PROGRAM_ID = 5
    // numRequiredSignatures = 1（仅 feePayer 签名）
    assert.equal(u.serializeState.messageBytes[0], 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('buildSplTokenTransfer：缺 mint / 非法 amount → 抛错', async () => {
  await assert.rejects(
    () => buildUnsigned(
      { type: 'token-transfer', from: FROM_ADDR, to: TO_ADDR, amount: '1000000', decimals: 6 },
      { chainKey: 'solana:mainnet-beta' }
    ),
    /mint required/
  );
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { value: { blockhash: base58Encode(new Uint8Array(32)) } } }) });
  try {
    await assert.rejects(
      () => buildUnsigned(
        { type: 'token-transfer', from: FROM_ADDR, to: TO_ADDR, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '0', decimals: 6 },
        { chainKey: 'solana:mainnet-beta' }
      ),
      /invalid amount/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});