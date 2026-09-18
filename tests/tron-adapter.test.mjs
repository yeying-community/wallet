/**
 * chain/adapters/tron 整体适配器单测
 * 运行：node --test tests/tron-adapter.test.mjs
 *
 * 覆盖：
 *  - tronAdapter 形态字段（namespace/family/curve/coinType）
 *  - chainKey / isValidAddress / displayAddress 行为
 *  - buildUnsigned：mock fetch 返回 fake createtransaction 响应，校验：
 *      - intent 字段（type/to/amount/from）解析
 *      - amount 必须为正整数 SUN
 *      - 地址 prefix 校验（mainnet 仅接受 0x41 prefix）
 *      - 返回的 UnsignedTx 形态（curve/payloads/serializeState/needsRecoveryId）
 *      - hashAlg = 'sha256'（不是 keccak256）
 *      - digest 是 sha256(raw_data_hex) 的 0x + 64 hex
 *  - assembleSigned：把签名 append 到 transaction JSON；signature 长度 = 65B hex (130 hex chars)
 *      - v 归一化（27/28 → 0/1）
 *      - r‖s 拼接、recid 0/1 都接受
 *      - 非法签名（rs 长度错误、recid 非 0/1、缺 r/s）抛错
 *  - broadcast：mock fetch /wallet/broadcasttransaction；返回 txid
 *      - 失败响应（{result:false}）抛错
 *      - 签名缺失抛错
 *  - getNativeBalance：mock fetch /wallet/getaccount，SUN → 0x hex
 *      - 账户不存在 → 0x0
 *      - 大数 SUN 正确转换（用 BigInt 路径）
 *  - getTokenBalance：v1 抛 NOT_IMPLEMENTED
 *  - registry.getAdapter('tron:*') 返回 tronAdapter；非 eip155/tron 仍抛 UNSUPPORTED_CHAIN
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tronAdapter
} from '../js/chain/adapters/tron/index.js';
import {
  buildUnsigned,
  assembleSigned
} from '../js/chain/adapters/tron/transaction.js';
import { getNativeBalance } from '../js/chain/adapters/tron/balance.js';
import { getAdapter } from '../js/chain/registry.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

// ==================== 测试 helpers ====================

/** mock globalThis.fetch；返回根据 url 路径派发的响应 */
function installFetchMock(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const handler = handlers[path];
    if (!handler) {
      throw new Error(`Mock fetch: no handler for ${path}`);
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return {
      ok: true,
      status: 200,
      json: async () => handler({ url: path, body })
    };
  };
  return () => {
    if (original === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = original;
    }
  };
}

/** 制造一个 createtransaction 风格的 raw_data_hex（任意 64 字节） */
function fakeCreateTransactionResponse(opts = {}) {
  const owner = opts.owner || 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW';
  const to = opts.to || 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x';
  const amount = opts.amount || 1000000; // 1 TRX in SUN
  // 任意 64 字节 raw_data_hex（签名只验证 sha256 一致即可）
  const rawBytes = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) rawBytes[i] = (i * 7 + 13) & 0xff;
  const rawHex = '0x' + Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const txID = ethers.sha256(rawBytes);
  return {
    visible: false,
    txID,
    raw_data: {
      contract: [{ parameter: { value: { amount, owner_address: owner, to_address: to }, type_url: 'type.googleapis.com/protocol.TransferContract' }, type: 'TransferContract' }],
      ref_block_bytes: 'abcd',
      ref_block_hash: '1234567890abcdef',
      expiration: Math.floor(Date.now() / 1000) + 3600,
      timestamp: Math.floor(Date.now() / 1000)
    },
    raw_data_hex: rawHex
  };
}

// ==================== adapter 形态字段 ====================

test('tronAdapter：namespace/family/curve/coinType 形态正确', () => {
  assert.equal(tronAdapter.namespace, 'tron');
  assert.equal(tronAdapter.family, 'tron');
  assert.equal(tronAdapter.curve, 'secp256k1');
  assert.equal(tronAdapter.coinType, 195);
});

test('tronAdapter：链族一致（namespace/family 同步）', () => {
  // chainKey 不依赖 family，但二者都应 'tron'
  const net = { reference: 'mainnet' };
  assert.equal(tronAdapter.chainKey(net), 'tron:mainnet');
  assert.equal(tronAdapter.chainKey({ reference: 'shasta' }), 'tron:shasta');
});

test('tronAdapter.isValidAddress / displayAddress', () => {
  assert.equal(tronAdapter.isValidAddress('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW'), true);
  assert.equal(tronAdapter.isValidAddress('0xabc'), false);
  // displayAddress 原样返回（Tron 已是 Base58Check 大小写敏感）
  assert.equal(tronAdapter.displayAddress('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW'),
    'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW');
});

// ==================== registry 派发 ====================

test('registry.getAdapter("tron:mainnet") → tronAdapter', () => {
  assert.equal(getAdapter('tron:mainnet'), tronAdapter);
  assert.equal(getAdapter('tron:shasta'), tronAdapter);
});

test('registry.getAdapter("eip155:1") 仍返回 evmAdapter（向后兼容）', () => {
  // 触发 evmAdapter 静态导入
  const evm = getAdapter('eip155:1');
  assert.equal(evm.namespace, 'eip155');
});

test('registry.getAdapter 未知命名空间 → UNSUPPORTED_CHAIN', () => {
  assert.throws(() => getAdapter('solana:mainnet'), /UNSUPPORTED_CHAIN/);
  assert.throws(() => getAdapter('bip122:000000000019d6689c085ae165831e93'), /UNSUPPORTED_CHAIN/);
});

// ==================== buildUnsigned ====================

test('buildUnsigned：合法 intent → 返回 UnsignedTx', async () => {
  const tx = fakeCreateTransactionResponse();
  const restore = installFetchMock({
    '/wallet/createtransaction': () => tx
  });

  const intent = {
    type: 'native-transfer',
    from: 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW',
    toAddress: 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x',
    amount: '1000000' // 1 TRX in SUN
  };
  const ctx = { chainKey: 'tron:mainnet' };
  const unsigned = await buildUnsigned(intent, ctx);

  assert.equal(unsigned.curve, 'secp256k1');
  assert.equal(unsigned.payloads.length, 1);
  assert.equal(unsigned.payloads[0].kind, 'digest');
  assert.equal(unsigned.payloads[0].hashAlg, 'sha256', 'Tron 摘要算法是 SHA-256，不是 keccak');
  assert.match(unsigned.payloads[0].bytes, /^0x[0-9a-f]{64}$/);
  // needsRecoveryId: false（Tron 协议不需要 recid；恢复 id 仅用于以太坊类签名）
  assert.equal(unsigned.needsRecoveryId, false);
  // serializeState 保留完整 transaction JSON
  assert.deepEqual(unsigned.serializeState.chainKey, 'tron:mainnet');
  assert.deepEqual(unsigned.serializeState.transaction.raw_data_hex, tx.raw_data_hex);

  restore();
});

test('buildUnsigned：digest = sha256(raw_data_hex 字节)', async () => {
  const tx = fakeCreateTransactionResponse();
  const restore = installFetchMock({
    '/wallet/createtransaction': () => tx
  });

  const unsigned = await buildUnsigned({
    type: 'native-transfer',
    from: 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW',
    toAddress: 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x',
    amount: '1'
  }, { chainKey: 'tron:mainnet' });

  const expected = ethers.sha256(ethers.getBytes(tx.raw_data_hex));
  assert.equal(unsigned.payloads[0].bytes, expected);

  restore();
});

test('buildUnsigned：mainnet 拒绝 testnet prefix 地址', async () => {
  const restore = installFetchMock({
    '/wallet/createtransaction': () => fakeCreateTransactionResponse()
  });

  await assert.rejects(
    () => buildUnsigned({
      type: 'native-transfer',
      from: 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW',
      toAddress: '27PAqdM7TzL3oZnzPBR8YXqhEo5siz4GZi7', // testnet prefix 0xa0
      amount: '1'
    }, { chainKey: 'tron:mainnet' }),
    /invalid to address for reference mainnet/
  );

  restore();
});

test('buildUnsigned：shasta 接受 testnet prefix 地址', async () => {
  const tx = fakeCreateTransactionResponse();
  const restore = installFetchMock({
    '/wallet/createtransaction': () => tx
  });

  // mainnet 占位 + shasta ref 接受的 testnet 前缀地址
  const unsigned = await buildUnsigned({
    type: 'native-transfer',
    from: '27PAqdM7TzL3oZnzPBR8YXqhEo5siz4GZi7',
    toAddress: '27PAqdM7TzL3oZnzPBR8YXqhEo5siz4GZi7',
    amount: '1'
  }, { chainKey: 'tron:shasta' });

  assert.equal(unsigned.payloads[0].hashAlg, 'sha256');

  restore();
});

test('buildUnsigned：缺少 toAddress 抛错', async () => {
  await assert.rejects(
    () => buildUnsigned({ type: 'native-transfer', from: 'T...', amount: '1' }, { chainKey: 'tron:mainnet' }),
    /missing to/
  );
});

test('buildUnsigned：amount 必须正整数', async () => {
  for (const bad of ['0', '-1', 'abc', '1.5', '']) {
    await assert.rejects(
      () => buildUnsigned({
        type: 'native-transfer',
        from: 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW',
        toAddress: 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x',
        amount: bad
      }, { chainKey: 'tron:mainnet' }),
      /invalid amount/
    );
  }
});

test('buildUnsigned：非 native-transfer 抛错', async () => {
  await assert.rejects(
    () => buildUnsigned({ type: 'token-transfer', from: 'T...', toAddress: 'T...', amount: '1' }, { chainKey: 'tron:mainnet' }),
    /only native-transfer/
  );
});

// ==================== assembleSigned ====================

test('assembleSigned：把签名附加到 transaction JSON，输出 130 hex chars 签名', () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: JSON.parse(JSON.stringify(tx)), chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const r = '0x' + '11'.repeat(32);
  const s = '0x' + '22'.repeat(32);
  const sig = { parts: [{ r, s, recid: 27 }] }; // ethers 给 27/28
  const out = assembleSigned(unsigned, sig);

  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.signature));
  assert.equal(parsed.signature.length, 1);
  // 签名应是 130 hex chars（r‖s‖v，v=0/1）
  assert.equal(parsed.signature[0].length, 130);
  // v 必须是 0x00 或 0x01（27 - 27 = 0）
  const v = parsed.signature[0].slice(-2);
  assert.ok(v === '00' || v === '01');
});

test('assembleSigned：v=28 → vByte=0x01', () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: JSON.parse(JSON.stringify(tx)), chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const r = '0x' + '11'.repeat(32);
  const s = '0x' + '22'.repeat(32);
  const out = assembleSigned(unsigned, { parts: [{ r, s, recid: 28 }] });
  const v = JSON.parse(out).signature[0].slice(-2);
  assert.equal(v, '01');
});

test('assembleSigned：rs 复合形式（part.rs = 0x + 128 hex）', () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: JSON.parse(JSON.stringify(tx)), chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const rs = '0x' + '11'.repeat(32) + '22'.repeat(32);
  const out = assembleSigned(unsigned, { parts: [{ rs, recid: 0 }] });
  const sig = JSON.parse(out).signature[0];
  assert.equal(sig.length, 130);
  assert.equal(sig.slice(0, 64), '11'.repeat(32));
  assert.equal(sig.slice(64, 128), '22'.repeat(32));
  assert.equal(sig.slice(-2), '00');
});

test('assembleSigned：rs 长度超过 64B 抛错', () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: JSON.parse(JSON.stringify(tx)), chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  // r 超过 64 hex chars（128 hex chars = 64B），违反规则
  const tooLongR = '0x' + '11'.repeat(64);
  const tooLongS = '0x' + '22'.repeat(64);
  assert.throws(
    () => assembleSigned(unsigned, { parts: [{ r: tooLongR, s: tooLongS, recid: 0 }] }),
    /signature must be 65 bytes/
  );
});

test('assembleSigned：recid 非法值抛错', () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: JSON.parse(JSON.stringify(tx)), chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const r = '0x' + '11'.repeat(32);
  const s = '0x' + '22'.repeat(32);
  // recid=5 既不是 0/1，减 27 后也不是 0/1
  assert.throws(
    () => assembleSigned(unsigned, { parts: [{ r, s, recid: 5 }] }),
    /recid must be 0 or 1/
  );
});

test('assembleSigned：缺 serializeState 抛错', () => {
  assert.throws(
    () => assembleSigned({}, { parts: [{ r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32), recid: 0 }] }),
    /missing serializeState/
  );
});

// ==================== broadcast ====================

test('broadcast：成功响应返回 txid', async () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: tx, chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const signed = assembleSigned(unsigned, {
    parts: [{ r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32), recid: 27 }]
  });

  const restore = installFetchMock({
    '/wallet/broadcasttransaction': () => ({ result: true, txid: tx.txID })
  });

  const out = await tronAdapter.broadcast(signed, { chainKey: 'tron:mainnet' });
  assert.equal(out, tx.txID);

  restore();
});

test('broadcast：失败响应（{result: false}）抛错', async () => {
  const tx = fakeCreateTransactionResponse();
  const unsigned = {
    curve: 'secp256k1',
    payloads: [{ kind: 'digest', bytes: tx.txID, hashAlg: 'sha256' }],
    serializeState: { transaction: tx, chainKey: 'tron:mainnet' },
    needsRecoveryId: false
  };
  const signed = assembleSigned(unsigned, {
    parts: [{ r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32), recid: 27 }]
  });

  const restore = installFetchMock({
    '/wallet/broadcasttransaction': () => ({ result: false, code: 'SIGERROR', message: 'bad sig' })
  });

  await assert.rejects(
    () => tronAdapter.broadcast(signed, { chainKey: 'tron:mainnet' }),
    /Tron broadcast failed/
  );

  restore();
});

test('broadcast：缺签名抛错', async () => {
  const tx = fakeCreateTransactionResponse();
  const incomplete = { ...tx, signature: undefined };
  await assert.rejects(
    () => tronAdapter.broadcast(JSON.stringify(incomplete), { chainKey: 'tron:mainnet' }),
    /missing signature/
  );
});

// ==================== getNativeBalance ====================

test('getNativeBalance：账户存在 → SUN → 0x hex', async () => {
  const restore = installFetchMock({
    '/wallet/getaccount': () => ({ balance: '1500000' }) // 1.5 TRX
  });

  const out = await getNativeBalance('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW', { chainKey: 'tron:mainnet' });
  assert.equal(out.balance, '0x16e360');

  restore();
});

test('getNativeBalance：账户不存在 → 0x0', async () => {
  const restore = installFetchMock({
    '/wallet/getaccount': () => null
  });

  const out = await getNativeBalance('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW', { chainKey: 'tron:mainnet' });
  assert.equal(out.balance, '0x0');

  restore();
});

test('getNativeBalance：大数 SUN 不丢精度', async () => {
  const bigSun = '99999999999999999999'; // > Number.MAX_SAFE_INTEGER
  const restore = installFetchMock({
    '/wallet/getaccount': () => ({ balance: bigSun })
  });

  const out = await getNativeBalance('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW', { chainKey: 'tron:mainnet' });
  // 0x56bc75e2d63100000 (BigInt 转换结果)
  assert.match(out.balance, /^0x[0-9a-f]+$/);
  // 用 BigInt 反向验算
  const hexBig = BigInt(out.balance);
  const decBig = BigInt(bigSun);
  assert.equal(hexBig, decBig);

  restore();
});

test('getNativeBalance：缺地址抛错', async () => {
  await assert.rejects(
    () => getNativeBalance('', { chainKey: 'tron:mainnet' }),
    /missing address/
  );
});

// ==================== signing-service Tron local-keyring path ====================
//
// 验证：signTransactionRaw('tron:mainnet', accountId, intent) 用 keyring 里的
// ethers.Wallet 私钥做 ECDSA（SHA-256 摘要）→ 组装 JSON 串 → broadcastRawTransaction
// 成功返回 txid。
//
// 测试方式：mock globalThis.fetch 处理 buildUnsigned 的 createtransaction 和
// broadcast 的 broadcasttransaction；同时直接注入 keyring Map 的 ethers.Wallet
// 实例，绕开 unlock 流程。

import { state } from '../js/background/state.js';
import { signTransactionRaw, broadcastRawTransaction } from '../js/chain/signing-service.js';test('signing-service Tron 本地签名 → broadcast 流程', async () => {
  // 1) mock fetch：createtransaction + broadcasttransaction
  const tx = fakeCreateTransactionResponse();
  const txid = tx.txID;
  const restore = installFetchMock({
    '/wallet/createtransaction': () => tx,
    '/wallet/broadcasttransaction': () => ({ result: true, txid })
  });

  // 2) 注入 keyring Map：用一个 Hardhat 公开私钥 + accountId
  if (!state.keyring) state.keyring = new Map();
  const TEST_PRIVKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const TEST_ACCOUNT_ID = 'tron-test-account-1';
  const wallet = new ethers.Wallet(TEST_PRIVKEY);
  state.keyring.set(TEST_ACCOUNT_ID, wallet);

  // 3) 调 signTransactionRaw：EVM/Tron 入口都接受 (chainKey, accountId, transaction)
  //    Tron 路径会自己派生 T 地址（与 mainnet prefix 0x41 一致）作为 owner_address。
  const intent = {
    type: 'native-transfer',
    from: 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG',
    toAddress: 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x',
    amount: '1000000'
  };
  const signedJson = await signTransactionRaw('tron:mainnet', TEST_ACCOUNT_ID, intent);
  assert.equal(typeof signedJson, 'string');
  const parsed = JSON.parse(signedJson);
  assert.ok(Array.isArray(parsed.signature));
  assert.equal(parsed.signature.length, 1);
  assert.equal(parsed.signature[0].length, 130, 'r‖s‖v = 130 hex chars (65B)');

  // 4) broadcast 走 adapter
  const out = await broadcastRawTransaction('tron:mainnet', signedJson);
  assert.equal(out, txid);

  // 清理：keyring + lockTimer（signTransactionRaw 间接触发 setTimeout）
  state.keyring.delete(TEST_ACCOUNT_ID);
  if (state.lockTimer) {
    clearTimeout(state.lockTimer);
    state.lockTimer = null;
  }
  restore();
});

test('signing-service Tron MPC 账户暂不支持 → UNSUPPORTED_OPERATION', async () => {
  const restore = installFetchMock({
    '/wallet/createtransaction': () => fakeCreateTransactionResponse()
  });

  const mpcAccountId = 'mpc:wallet-xyz';
  // isMpcAccountId 短路检查在 getWalletInstance 之前，不需要注入 keyring
  await assert.rejects(
    () => signTransactionRaw('tron:mainnet', mpcAccountId, {
      type: 'native-transfer',
      from: 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG',
      toAddress: 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x',
      amount: '1'
    }),
    (err) => String(err.code) === 'UNSUPPORTED_OPERATION'
  );

  restore();
});

// ==================== getTokenBalance（v1 NOT_IMPLEMENTED） ====================

test('getTokenBalance：v1 抛 NOT_IMPLEMENTED（TRC20 暂不支持）', async () => {
  await assert.rejects(
    () => tronAdapter.getTokenBalance('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW', { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, { chainKey: 'tron:mainnet' }),
    /CHAIN_ADAPTER_NOT_IMPLEMENTED/
  );
});