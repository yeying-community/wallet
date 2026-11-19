/**
 * 知行图密钥文件导入:Keccak-256、scrypt 与 Web3 Secret Storage v3 解密,以及明文种子文件解析。
 *
 * 期望值:
 *   - Keccak-256 官方向量;scrypt 用 RFC 7914 向量;
 *   - 密钥文件与种子文件由知行图的 Rust 节点(`node keygen --mnemonic <官方测试助记词> [--encrypt]`)生成,
 *     解出的种子必须等于同一助记词推出的种子、公钥必须等于节点打印的公钥。
 * 助记词是 BIP-39 官方测试向量(全零熵),不是任何真实成员的密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;

const { keccak256, scrypt, decryptZhixingKeystore, parseZhixingSeedFile, bytesToHex } =
  await import('../js/chain/adapters/zhixing/keystore.js');
const { zhixingSeedFromMnemonic, zhixingAddressFromSeed } = await import('../js/chain/adapters/zhixing/keys.js');

const ZERO24 = Array(23).fill('abandon').join(' ') + ' art';
const ZERO24_PUBKEY = '1de352e44cd333672593f2334a730e180aaf290de89aa16d480de594e34e2961';
// `ZHIXING_KEYSTORE_PASSWORD=ks-password-123 node keygen --mnemonic "<ZERO24>" --encrypt --out ks.json`
const RUST_KEYSTORE = "{\n  \"crypto\": {\n    \"kdf\": \"scrypt\",\n    \"kdfparams\": {\n      \"dklen\": 32,\n      \"n\": 262144,\n      \"r\": 8,\n      \"p\": 1,\n      \"salt\": \"8d79ebdbab555a47cbeff211796fa143\"\n    },\n    \"cipher\": \"aes-128-ctr\",\n    \"cipherparams\": {\n      \"iv\": \"25fedff31c10c296879361a823d474ff\"\n    },\n    \"ciphertext\": \"48200e58b26602e7d47db0426c4e2f56cfd9b6f8a3373e6d6128e11c2f4a6688\",\n    \"mac\": \"f5159baff43506006fe5b2e8851f5a9fe44b3067e1e7e25c87d3d280d97be23c\"\n  },\n  \"id\": \"50f25da7-77ed-43bb-928d-86a4df6da569\",\n  \"version\": 3\n}";
// `node keygen --mnemonic "<ZERO24>" --out seed.txt`(去掉了 # mnemonic 注释行)
const RUST_SEED_FILE = "# zhixing-node validator key (M169 \u00b7 BIP-39)\n# passphrase: <empty>\n# pubkey: 1de352e44cd333672593f2334a730e180aaf290de89aa16d480de594e34e2961\n408b285c123836004f4b8842c89324c1f01382450c0d439af345ba7fc49acf70\n";

test('Keccak-256 官方向量(以太坊用的原始 Keccak,不是 SHA3-256)', () => {
  const h = (s) => bytesToHex(keccak256(new TextEncoder().encode(s)));
  assert.equal(h(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(h('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
});

test('scrypt RFC 7914 测试向量', async () => {
  const e = new TextEncoder();
  assert.equal(bytesToHex(await scrypt(e.encode('password'), e.encode('NaCl'), 1024, 8, 16, 64)),
    'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640');
  assert.equal(bytesToHex(await scrypt(e.encode('pleaseletmein'), e.encode('SodiumChloride'), 16384, 8, 1, 64)),
    '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887');
});

test('解开 Rust 节点写的密钥文件:种子与助记词推出的一致,公钥与节点打印的一致', async () => {
  const seed = await decryptZhixingKeystore(RUST_KEYSTORE, 'ks-password-123');
  assert.equal('0x' + bytesToHex(seed), zhixingSeedFromMnemonic(ZERO24));
  assert.equal(zhixingAddressFromSeed('0x' + bytesToHex(seed)), ZERO24_PUBKEY);
});

test('密钥文件:口令错、不是 JSON、参数越界都被拒绝', async () => {
  await assert.rejects(decryptZhixingKeystore(RUST_KEYSTORE, 'wrong-password'), /口令不对/);
  await assert.rejects(decryptZhixingKeystore('{not json', 'x'), /无法解析/);
  const evil = JSON.parse(RUST_KEYSTORE);
  evil.crypto.kdfparams.n = 2 ** 24;
  await assert.rejects(decryptZhixingKeystore(JSON.stringify(evil), 'x'), /超出支持范围/);
});

test('明文种子文件:解析出种子与注释里的公钥,公钥与种子一致', () => {
  const f = parseZhixingSeedFile(RUST_SEED_FILE);
  assert.equal(f.pubkey, ZERO24_PUBKEY);
  assert.equal(f.passphrase, '');
  assert.equal(zhixingAddressFromSeed('0x' + f.seedHex), ZERO24_PUBKEY);
  assert.equal('0x' + f.seedHex, zhixingSeedFromMnemonic(ZERO24));
  assert.equal(parseZhixingSeedFile('  ' + f.seedHex.toUpperCase() + '\n').seedHex, f.seedHex);
  assert.throws(() => parseZhixingSeedFile('hello'), /不是知行图的种子文件/);
});
