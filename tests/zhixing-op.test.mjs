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
  zhixingStandardSeedFromMnemonic,
  zhixingKeypairFromSeed,
  zhixingAddressFromSeed,
  isZhixingAddress
} from '../js/chain/adapters/zhixing/keys.js';

const V = {
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  "seedHex": "932f58d24bb68ea25cc6d7ee82013bed850a9e3fb36b8dd773bc9181e9d39a3e",
  "pubkey": "741c8d9dcb69f5c2ae4e1009408613b47620f7360298c4bbae93f864364f9d57",
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
      "signedHex": "0000000000000003020000000000000008000000020000000000000000000000000000000000000000000000000000000000000000000000000000000007f1cc6572cfd56fa647b35699a54aad34b03ed70502f4d34e3bc7f6095dbcb13b908729c8d2cc4f4878ac4a9f661d3ff9eb2c54c10a7ae34e1e7eaf1d7251dc0d"
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
      "signedHex": "0000010000000000020000000000000001000000010100000000000000000000000000000000000000000000000000000000000000000000000200000000e5ecb2b799a4aad47e8da95bd3f3cc445e24b851f255c54269c2dfc4ceaf4c790b8d45384f0cc0f406e67cf2d90fe39f04168544f44872d6ca590cff41f10504"
    },
    {
      "actor": 1,
      "action": {
        "type": "invite",
        "pubkey": "1111111111111111111111111111111111111111111111111111111111111111"
      },
      "nonce": 0,
      "signedHex": "00000000000000010311111111111111111111111111111111111111111111111111111111111111110000000000000000c9ae674a46f95fea9f1045a2c90d248b1eca2581db331eaa5f95a991ca50637de5d1bcfb1ddfccc9b15a5b3b4bf65ecd2bbaa9e738758e6aa51362e641ee8f01"
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
      "signedHex": "00000000000000020000000000010000000000000001000000027a68abababababababababababababababababababababababababababababababab010000000f636c617564652d6f7075732d352d35000000000000000200000000000000080000000200000000000000000900000001010000000000000018197d2522982104c81b814a4561d3194cc55c4ecbde5280e5889950576eb0cdba0d02fbb6d5c075536dc8155a5484afff288be15a8cb5641e3551dcfbb6461f0e"
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
      "signedHex": "000000000000000201000000000000000f0000000000000002000000027a68abababababababababababababababababababababababababababababababab00000002656ecdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd00000000000000000100000000000000030000000102000000000000006309c4a31b566c78688a4b472b82b430412cb408ed8101d8355ef2121b744b9d29945bc84edb8437b4e21e9a7e0018a7407f38de40a0bde450d3a9dad00df9c007"
    }
  ]
};

test('助记词 → 种子 → 公钥 与知行图节点一致(与既有成员身份兼容)', () => {
  const seed = zhixingStandardSeedFromMnemonic(V.mnemonic);
  assert.equal(seed, '0x' + V.seedHex);
  assert.equal(zhixingAddressFromSeed(seed), V.pubkey);
  assert.ok(isZhixingAddress(V.pubkey));
});

test('助记词里多余的空白不影响派生', () => {
  const messy = '  ' + V.mnemonic.split(' ').join('   ') + '\n';
  assert.equal(zhixingStandardSeedFromMnemonic(messy), '0x' + V.seedHex);
});

test('附加口令改变密钥(与 BIP-39 一致)', () => {
  assert.notEqual(zhixingStandardSeedFromMnemonic(V.mnemonic, 'x'), '0x' + V.seedHex);
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
