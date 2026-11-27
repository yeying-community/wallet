/**
 * 导出知行图密钥文件(Web3 Secret Storage v3):格式必须与 Rust 节点完全一致。
 *
 * 链侧的签名工具(`node encode-knowledge-op --key-file`、命令行 `zx`)认这个格式,
 * 所以钱包导出的文件要能被节点读出来——不然用户还得手工复制私钥。
 *
 * 期望值:
 *   - 用 Rust 节点写的密钥文件(`node encrypt-key`)做对照:钱包写的文件,
 *     用同一个口令能被钱包自己解开,解出的种子与公钥与节点打印的一致;
 *   - 钱包写的文件交给**真实的节点二进制**读,得到同一个公钥(跨仓库的检验);
 *   - 参数与节点一致:scrypt(n=2^18,r=8,p=1)、AES-128-CTR、mac = Keccak256(dk[16..32]‖ct)。
 *
 * 助记词是 BIP-39 官方测试向量(全零熵),不是任何真实成员的密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

globalThis.crypto ||= webcrypto;

const { encryptZhixingKeystore, decryptZhixingKeystore, bytesToHex, hexToBytes } =
  await import('../js/chain/adapters/zhixing/keystore.js');
const { zhixingStandardSeedFromMnemonic, zhixingAddressFromSeed } =
  await import('../js/chain/adapters/zhixing/keys.js');

const ZERO24 = Array(23).fill('abandon').join(' ') + ' art';
// `node keygen --mnemonic "<ZERO24>"` 给出的公钥(SLIP-0010 m/44'/1105'/0'/0'/0')
const ZERO24_PUBKEY = '741c8d9dcb69f5c2ae4e1009408613b47620f7360298c4bbae93f864364f9d57';
const ZERO24_SEED = '932f58d24bb68ea25cc6d7ee82013bed850a9e3fb36b8dd773bc9181e9d39a3e';

// 知行图节点的二进制(不在这个仓库里时跳过跨仓库检验)
const NODE_BIN = process.env.ZHIXING_NODE_BIN
  || join(process.cwd(), '..', 'blockchain', 'node', 'target', 'release', 'node');

function seedBytes() {
  return hexToBytes(ZERO24_SEED);
}

test('导出的密钥文件:口令能解开,种子与公钥都对', async () => {
  const seed = seedBytes();
  const json = await encryptZhixingKeystore(seed, 'file-password-123');
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.crypto.kdf, 'scrypt');
  assert.equal(parsed.crypto.cipher, 'aes-128-ctr');
  // 参数与节点一致(node/src/keystore.rs)
  assert.equal(parsed.crypto.kdfparams.n, 2 ** 18);
  assert.equal(parsed.crypto.kdfparams.r, 8);
  assert.equal(parsed.crypto.kdfparams.p, 1);
  assert.equal(parsed.crypto.kdfparams.dklen, 32);
  assert.match(parsed.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const back = await decryptZhixingKeystore(json, 'file-password-123');
  assert.equal(bytesToHex(back), ZERO24_SEED);
  assert.equal(zhixingAddressFromSeed('0x' + bytesToHex(back)), ZERO24_PUBKEY);
});

test('导出的密钥文件:口令不对被拒绝', async () => {
  const json = await encryptZhixingKeystore(seedBytes(), 'file-password-123');
  await assert.rejects(() => decryptZhixingKeystore(json, 'wrong-password'), /口令不对/);
});

test('每次导出都用新的盐与 iv(同一个种子两次导出得到不同的文件)', async () => {
  const a = JSON.parse(await encryptZhixingKeystore(seedBytes(), 'file-password-123'));
  const b = JSON.parse(await encryptZhixingKeystore(seedBytes(), 'file-password-123'));
  assert.notEqual(a.crypto.kdfparams.salt, b.crypto.kdfparams.salt);
  assert.notEqual(a.crypto.cipherparams.iv, b.crypto.cipherparams.iv);
  assert.notEqual(a.crypto.ciphertext, b.crypto.ciphertext);
  // 但解出来的种子一样
  const seedA = await decryptZhixingKeystore(JSON.stringify(a), 'file-password-123');
  const seedB = await decryptZhixingKeystore(JSON.stringify(b), 'file-password-123');
  assert.equal(bytesToHex(seedA), bytesToHex(seedB));
});

test('导出的密钥文件:真实的节点二进制能读出同一个公钥', async (t) => {
  if (!existsSync(NODE_BIN)) {
    t.skip(`找不到节点二进制 ${NODE_BIN}(设 ZHIXING_NODE_BIN 指向它)`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'zx-ks-export-'));
  try {
    const file = join(dir, 'zhixing-keystore.json');
    writeFileSync(file, await encryptZhixingKeystore(seedBytes(), 'file-password-123'));
    const out = execFileSync(NODE_BIN, ['pubkey', '--key-file', file], {
      env: { ...process.env, ZHIXING_KEYSTORE_PASSWORD: 'file-password-123' },
      encoding: 'utf8'
    });
    assert.match(out, new RegExp(ZERO24_PUBKEY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('口令太短被拒绝', async () => {
  await assert.rejects(() => encryptZhixingKeystore(seedBytes(), 'short'), /至少 8 个字符/);
});

test('导出的文件名带上账户名称(便于一个人导多个账户时分辨)', async () => {
  // 账户名里可能有路径分隔符或特殊字符,文件名里要去掉
  const { sanitizeFileNamePart } = await import('../js/background/operations/wallet.js')
    .catch(() => ({ sanitizeFileNamePart: null }));
  if (!sanitizeFileNamePart) {
    // 那个模块依赖浏览器环境,这里只测纯函数:直接从源码里取
    const src = (await import('node:fs')).readFileSync(
      new URL('../js/background/operations/wallet.js', import.meta.url), 'utf8');
    const m = src.match(/function sanitizeFileNamePart\(name\) \{[\s\S]*?\n\}/);
    assert.ok(m, '应当有 sanitizeFileNamePart');
    const fn = eval('(' + m[0].replace('function sanitizeFileNamePart', 'function') + ')');
    assert.equal(fn('alice'), 'alice');
    assert.equal(fn('我的账户'), '我的账户', '中文名保留');
    assert.equal(fn('a/b\\c'), 'ab\\c', '路径分隔符去掉');
    assert.equal(fn('  spaced  name  '), 'spaced-name');
    assert.equal(fn(''), '');
    assert.equal(fn('x'.repeat(80)).length, 40, '长度封顶');
    return;
  }
});
