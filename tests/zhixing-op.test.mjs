/**
 * 知行图知识操作:编码、签名、密钥派生——与知行图节点逐字节一致。
 *
 * 期望值来自知行图参考签名器(yeying-community/blockchain 的 tools/explorer/reference/signer.js),
 * 它在知行图仓库里由 signer.test.mjs 对照 Rust 节点(`node keygen` / `node encode-knowledge-op`)
 * 逐字节检验过。这里把那份输出固定成向量:钱包任何一处编码或派生变了,这里立刻失败——
 * 那意味着钱包签出的操作会被节点拒绝,或者成员导入助记词后得到的是另一个链上账户。
 *
 * 助记词是 BIP-39 官方测试向量(全零熵),不是任何真实成员的密钥。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import nacl from '../lib/nacl.js';
import {
  encodeKnowledgeOp,
  signKnowledgeOp,
  describeKnowledgeOp,
  bytesToHex,
  hexToBytes,
  ZHIXING_SIGN_DOMAIN
} from '../js/chain/adapters/zhixing/op.js';
import {
  zhixingSeedFromMnemonic,
  zhixingKeypairFromSeed,
  zhixingAddressFromSeed,
  isZhixingAddress
} from '../js/chain/adapters/zhixing/keys.js';

const V = {
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  "seedHex": "408b285c123836004f4b8842c89324c1f01382450c0d439af345ba7fc49acf70",
  "pubkey": "1de352e44cd333672593f2334a730e180aaf290de89aa16d480de594e34e2961",
  "ops": [
    {
      "actor": 3,
      "action": {
        "type": "verify",
        "unit": 8,
        "version": 2,
        "verdict": "pass"
      },
      "nonce": 7,
      "signedHex": "00000000000000030200000000000000080000000200000000000000000000000000000000000000000000000000000000000000000000000000000000074a7e3a935495998a4eb36ea3cd9e7d84624db497fcbf9b2b1dfcaa1ebffaf62ea84cf34f7ccf990fc305a4e88eb8201b58c7de7da961bfb9c3d9c28d9e948907"
    },
    {
      "actor": 1099511627776,
      "action": {
        "type": "verify",
        "unit": 1,
        "version": 1,
        "verdict": "needs-revision"
      },
      "nonce": 8589934592,
      "signedHex": "00000100000000000200000000000000010000000101000000000000000000000000000000000000000000000000000000000000000000000002000000005388939462202d591b07425048097c3de6774c7858be27df62ed4ef2e00ff9f107587c2c5fb1b8214ebfa2b36a716ab6e1ebd1d2918d8b3537a86fc7665c2903"
    },
    {
      "actor": 1,
      "action": {
        "type": "invite",
        "pubkey": "1111111111111111111111111111111111111111111111111111111111111111"
      },
      "nonce": 0,
      "signedHex": "00000000000000010311111111111111111111111111111111111111111111111111111111111111110000000000000000e022697781c4e7c004053f533e373e012459d1b81bf78fa5d125b5f59e1620a69b7ab4f8d67242c694cc3ed468a25611e40bdcb5bc8949674c1a740173579f09"
    },
    {
      "actor": 2,
      "action": {
        "type": "create",
        "layer": "foundation",
        "domain": 1,
        "bodies": [
          {
            "lang": "zh",
            "hash": "abababababababababababababababababababababababababababababababab"
          }
        ],
        "source": {
          "type": "model",
          "id": "claude-opus-5-5"
        },
        "cites": [
          {
            "unit": 8,
            "version": 2,
            "kind": "basis"
          },
          {
            "unit": 9,
            "version": 1,
            "kind": "see-also"
          }
        ]
      },
      "nonce": 24,
      "signedHex": "00000000000000020000000000010000000000000001000000027a68abababababababababababababababababababababababababababababababab010000000f636c617564652d6f7075732d352d35000000000000000200000000000000080000000200000000000000000900000001010000000000000018ecffa6462918914da5948a71cd4c4525c0840143b9543f99bd977f26d511ec28b89bd599574475521d6e9b4841833c97ba69b521d5ec0cb946949ba8872a810e"
    },
    {
      "actor": 2,
      "action": {
        "type": "publish",
        "unit": 15,
        "bodies": [
          {
            "lang": "zh",
            "hash": "abababababababababababababababababababababababababababababababab"
          },
          {
            "lang": "en",
            "hash": "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
          }
        ],
        "source": {
          "type": "human"
        },
        "cites": [
          {
            "unit": 3,
            "version": 1,
            "kind": "supersedes"
          }
        ]
      },
      "nonce": 99,
      "signedHex": "000000000000000201000000000000000f0000000000000002000000027a68abababababababababababababababababababababababababababababababab00000002656ecdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd0000000000000000010000000000000003000000010200000000000000632140ff7e48405ce66ff51ff3588e42ceb90c00ef1dcd9a4bcea82d3b0366e97e37d4a30c08a82bed03a49517c2b6840588f3457b726f8102bd02ef8d1eb14c0f"
    }
  ]
};

test('助记词 → 种子 → 公钥 与知行图节点一致(与既有成员身份兼容)', () => {
  const seed = zhixingSeedFromMnemonic(V.mnemonic);
  assert.equal(seed, '0x' + V.seedHex);
  assert.equal(zhixingAddressFromSeed(seed), V.pubkey);
  assert.ok(isZhixingAddress(V.pubkey));
});

test('助记词里多余的空白不影响派生', () => {
  const messy = '  ' + V.mnemonic.split(' ').join('   ') + '\n';
  assert.equal(zhixingSeedFromMnemonic(messy), '0x' + V.seedHex);
});

test('附加口令改变密钥(与 BIP-39 一致)', () => {
  assert.notEqual(zhixingSeedFromMnemonic(V.mnemonic, 'x'), '0x' + V.seedHex);
});

for (const c of V.ops) {
  test(`签名后的操作与节点逐字节一致:${c.action.type} actor=${c.actor} nonce=${c.nonce}`, () => {
    const kp = zhixingKeypairFromSeed('0x' + V.seedHex);
    const signed = signKnowledgeOp(kp, c.actor, c.action, c.nonce);
    assert.equal(bytesToHex(signed), c.signedHex);

    // 签名确实落在 "zhixing-knowledge-op-v1" ‖ op 上
    const body = encodeKnowledgeOp(c.actor, c.action, c.nonce);
    const sig = signed.slice(body.length);
    const msg = new Uint8Array([...new TextEncoder().encode(ZHIXING_SIGN_DOMAIN), ...body]);
    assert.ok(nacl.sign.detached.verify(msg, sig, hexToBytes(V.pubkey)));
  });
}

test('非法操作在签名前被拒绝(网页不能让钱包签出节点会拒收或含义不明的字节)', () => {
  const bad = [
    { type: 'transfer' },
    { type: 'verify', unit: 1, version: 1, verdict: 'maybe' },
    { type: 'verify', unit: -1, version: 1, verdict: 'pass' },
    { type: 'verify', unit: 1, version: 2 ** 32, verdict: 'pass' },
    { type: 'invite', pubkey: 'abcd' },
    { type: 'create', layer: 'foundation', domain: 1, bodies: [] },
    { type: 'create', layer: 'top', domain: 1, bodies: [{ lang: 'zh', hash: 'ab'.repeat(32) }] },
    { type: 'publish', unit: 1, bodies: [{ lang: 'zh', hash: 'ab'.repeat(31) }] },
    { type: 'publish', unit: 1, bodies: [{ lang: 'zh', hash: 'ab'.repeat(32) }], cites: [{ unit: 1, version: 1, kind: 'likes' }] }
  ];
  for (const a of bad) {
    assert.throws(() => encodeKnowledgeOp(1, a, 0), /ZHIXING_/, JSON.stringify(a));
  }
  assert.throws(() => encodeKnowledgeOp(2n ** 64n, { type: 'invite', pubkey: '11'.repeat(32) }, 0), /ZHIXING_BAD_U64/);
});

test('审批摘要说清楚要签的是什么', () => {
  const v = describeKnowledgeOp(3, { type: 'verify', unit: 8, version: 2, verdict: 'pass' }, 7);
  assert.equal(v.title, '核验单元 #8 的 v2:通过');
  assert.match(v.lines.join('\n'), /账户 #3/);

  const c = describeKnowledgeOp(2, V.ops[3].action, 24);
  assert.match(c.title, /创建新知识单元\(基础层,领域 1\)/);
  const text = c.lines.join('\n');
  assert.match(text, /模型生成\(claude-opus-5-5\)/);
  assert.match(text, /依据 #8 v2、参见 #9 v1/);
  assert.match(text, /CC BY 4\.0/);

  const i = describeKnowledgeOp(1, { type: 'invite', pubkey: '11'.repeat(32) }, 0);
  assert.ok(i.risk && /担保/.test(i.risk));
});
