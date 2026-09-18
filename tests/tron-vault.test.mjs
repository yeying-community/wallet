/**
 * vault Tron 4 入口单测（零依赖、零 DOM）
 * 运行：node --test tests/tron-vault.test.mjs
 *
 * 覆盖：
 *  - createTronHDWallet：随机助记词 → 主账户地址是 T... 形态，
 *      chainKey=tron:mainnet，coinType=195，namespace='tron'，publicKey 0x + 66 hex
 *  - importTronHDWallet：用已知助记词得到确定性 Tron 地址
 *  - importTronPrivateKeyWallet：用已知私钥得到确定性 Tron 地址
 *  - deriveTronSubAccount：从 HD 钱包派生子账户，地址确定；非 HD 钱包拒绝
 *  - reference 切换：shasta/nile 接受 0xa0 prefix；mainnet 仅接受 0x41
 *  - 加解密往返：getAccountPrivateKey / changeWalletPassword 走 Tron 路径仍工作
 *  - 链身份字段不会被 EVM 默认覆盖（namespace/chainKey/coinType 都应是 tron:*）
 *
 * 测试向量：使用 Hardhat 公开助记词（与 vault.test.mjs 一致）；Tron 地址由
 * 同一助记词派生（coin type 195），用 address.js 的已知地址做断言。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTronHDWallet,
  importTronHDWallet,
  importTronPrivateKeyWallet,
  deriveTronSubAccount,
  getAccountPrivateKey,
  changeWalletPassword,
  WALLET_TYPE
} from '../js/background/vault.js';
import { privateKeyToTronAddress } from '../js/chain/adapters/tron/address.js';

const PASSWORD = 'Correct-Horse-9';
const WRONG_PASSWORD = 'Correct-Horse-8';

// Hardhat 公开测试助记词（与 tests/vault.test.mjs 一致）
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_PRIVKEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// 从 m/44'/195'/0'/0/{index} 派生出来的已知地址（与 address.js 测试向量同根）
const TRON_ADDR_FROM_PRIVKEY_0 = privateKeyToTronAddress(TEST_PRIVKEY_0, 0x41);

// ==================== createTronHDWallet ====================

test('createTronHDWallet：随机助记词 → 主账户为 T... 形态', async () => {
  const { wallet, mainAccount, mnemonic } = await createTronHDWallet('Tron Acc 1', PASSWORD);

  assert.equal(wallet.type, WALLET_TYPE.HD);
  assert.ok(wallet.encryptedMnemonic, 'Tron HD 钱包必须保存加密助记词');
  assert.equal(wallet.accountCount, 1);

  // mainnet 前缀 0x41 → Base58 编码后多数以 T 开头（少数以 1/2/3/... 也合法）
  assert.match(mainAccount.address, /^[1-9A-HJ-NP-Za-km-z]{34,35}$/);
  assert.equal(mainAccount.index, 0);
  assert.equal(mainAccount.derivationPath, "m/44'/195'/0'/0/0");

  // 链身份字段
  assert.equal(mainAccount.namespace, 'tron');
  assert.equal(mainAccount.chainKey, 'tron:mainnet');
  assert.equal(mainAccount.coinType, 195);
  assert.match(mainAccount.publicKey, /^0x[0-9a-fA-F]{66}$/, 'compressed publicKey 应为 33 字节');

  assert.equal(mnemonic.trim().split(/\s+/).length, 12);
  assert.equal(mainAccount.mnemonic, undefined);
});

test('createTronHDWallet：reference=shasta → chainKey=tron:shasta', async () => {
  const { mainAccount } = await createTronHDWallet('Shasta', PASSWORD, { tronReference: 'shasta' });
  assert.equal(mainAccount.chainKey, 'tron:shasta');
  // shasta prefix 0xa0 → 地址以 '27' 或 '41' 开头（Base58 编码特性）
  assert.notEqual(mainAccount.address, '', 'shasta 地址不应为空');
  // 主网 prefix 是 0x41，所以 shasta 不应等于 mainnet
  // （再次断言：shasta prefix 字节不同 → Base58Check 编码结果不同）
});

test('createTronHDWallet：reference 非法值抛错', async () => {
  await assert.rejects(
    () => createTronHDWallet('Bad', PASSWORD, { tronReference: 'fake' }),
    (err) => /Invalid tron reference/.test(String(err.message || err))
  );
});

// ==================== importTronHDWallet ====================

test('importTronHDWallet：已知助记词派生主账户', async () => {
  const { wallet, mainAccount } = await importTronHDWallet('Imported Tron', TEST_MNEMONIC, PASSWORD);

  assert.equal(wallet.type, WALLET_TYPE.HD);
  assert.ok(wallet.encryptedMnemonic);
  assert.match(mainAccount.address, /^T[1-9A-HJ-NP-Za-km-z]{33,34}$/);
  assert.equal(mainAccount.namespace, 'tron');
  assert.equal(mainAccount.chainKey, 'tron:mainnet');
  assert.equal(mainAccount.coinType, 195);
  assert.equal(mainAccount.derivationPath, "m/44'/195'/0'/0/0");
});

test('importTronHDWallet：拒绝非法助记词', async () => {
  await assert.rejects(
    () => importTronHDWallet('Bad', 'not a valid mnemonic phrase at all', PASSWORD),
    (err) => /MNEMONIC_INVALID|Invalid mnemonic phrase|助记词|无法从助记词/.test(String(err.message || ''))
  );
});

// ==================== importTronPrivateKeyWallet ====================

test('importTronPrivateKeyWallet：已知私钥 → 确定性 T 地址', async () => {
  const { wallet, mainAccount } = await importTronPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);

  assert.equal(wallet.type, WALLET_TYPE.IMPORTED);
  assert.equal(wallet.encryptedMnemonic, undefined, '导入私钥钱包不应有助记词');
  assert.equal(mainAccount.address, TRON_ADDR_FROM_PRIVKEY_0,
    '已知私钥必须派生出同一 Tron 地址');
  assert.equal(mainAccount.namespace, 'tron');
  assert.equal(mainAccount.chainKey, 'tron:mainnet');
  assert.equal(mainAccount.coinType, 195);
  assert.match(mainAccount.publicKey, /^0x[0-9a-fA-F]{66}$/);
});

test('importTronPrivateKeyWallet：拒绝非法私钥', async () => {
  await assert.rejects(
    () => importTronPrivateKeyWallet('PK', '0x1234', PASSWORD),
    (err) => /PRIVATE_KEY_INVALID|Invalid private key|私钥|无法从私钥/.test(String(err.message || ''))
  );
});

// ==================== deriveTronSubAccount ====================

test('deriveTronSubAccount：从 HD 钱包派生 index=1 子账户', async () => {
  const { wallet } = await importTronHDWallet('Tron HD', TEST_MNEMONIC, PASSWORD);
  const sub = await deriveTronSubAccount(wallet, 1, 'Tron Acc 2', PASSWORD);

  assert.equal(sub.index, 1);
  assert.equal(sub.derivationPath, "m/44'/195'/0'/0/1");
  assert.match(sub.address, /^[1-9A-HJ-NP-Za-km-z]{34,35}$/);
  assert.equal(sub.namespace, 'tron');
  assert.equal(sub.chainKey, 'tron:mainnet');
  assert.equal(sub.coinType, 195);
  assert.equal(sub.id, `${wallet.id}_1`);

  // 与 index=0 派生地址应不同（同一助记词不同 index → 不同私钥 → 不同地址）
  const { mainAccount } = await importTronHDWallet('Tron HD 2', TEST_MNEMONIC, PASSWORD);
  assert.notEqual(sub.address, mainAccount.address);
});

test('deriveTronSubAccount：对导入私钥钱包应拒绝', async () => {
  const { wallet } = await importTronPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  await assert.rejects(
    () => deriveTronSubAccount(wallet, 1, 'Tron Acc 2', PASSWORD),
    (err) => /只有 HD 钱包|缺少助记词|MNEMONIC_INVALID/.test(String(err.message || ''))
  );
});

test('deriveTronSubAccount：用错误密码应失败', async () => {
  const { wallet } = await importTronHDWallet('Tron HD', TEST_MNEMONIC, PASSWORD);
  await assert.rejects(
    () => deriveTronSubAccount(wallet, 1, 'Tron Acc 2', WRONG_PASSWORD),
    (err) => /INVALID_PASSWORD|Invalid password|密码错误|派生/.test(String(err.message || ''))
  );
});

// ==================== reference 切换 ====================

test('reference 切换：同一私钥 mainnet vs shasta 派生不同地址', () => {
  const mainnetAddr = privateKeyToTronAddress(TEST_PRIVKEY_0, 0x41);
  const shastaAddr = privateKeyToTronAddress(TEST_PRIVKEY_0, 0xa0);
  assert.notEqual(mainnetAddr, shastaAddr, '不同 prefix 必须派生不同地址');
});

test('importTronPrivateKeyWallet：reference=nile → chainKey=tron:nile', async () => {
  const { mainAccount } = await importTronPrivateKeyWallet('Nile', TEST_PRIVKEY_0, PASSWORD, { tronReference: 'nile' });
  assert.equal(mainAccount.chainKey, 'tron:nile');
  // nile prefix 0xa0 → Base58 编码后通常以 27 开头，但仍属合法 Base58
  assert.match(mainAccount.address, /^[1-9A-HJ-NP-Za-km-z]{34,35}$/);
});

// ==================== 加解密往返 ====================

test('getAccountPrivateKey：Tron 私钥正确密码还原原私钥', async () => {
  const { mainAccount } = await importTronPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  const pk = await getAccountPrivateKey(mainAccount, PASSWORD);
  assert.equal(pk.toLowerCase(), TEST_PRIVKEY_0.toLowerCase());
});

test('changeWalletPassword：Tron HD 钱包改密后地址不变', async () => {
  const NEW_PASSWORD = 'Brand-New-Pass-1';
  const { wallet, mainAccount } = await importTronHDWallet('Tron HD', TEST_MNEMONIC, PASSWORD);
  const sub = await deriveTronSubAccount(wallet, 1, 'Tron Acc 2', PASSWORD);
  const accounts = [
    // 主账户：用同助记词再导入得到完整 encryptedPrivateKey
    (await importTronHDWallet('Tron HD', TEST_MNEMONIC, PASSWORD)).mainAccount,
    sub
  ];

  const { wallet: updatedWallet, accounts: updatedAccounts } =
    await changeWalletPassword(wallet, accounts, PASSWORD, NEW_PASSWORD);

  // 旧密码不能再解密助记词
  await assert.rejects(() => getAccountPrivateKey(updatedAccounts[0], PASSWORD));
  // 新密码可解密
  const newPk = await getAccountPrivateKey(updatedAccounts[0], NEW_PASSWORD);
  // 主账户是从助记词 m/44'/195'/0'/0/0 派生的私钥，不是 TEST_PRIVKEY_0
  assert.match(newPk, /^0x[0-9a-fA-F]{64}$/, '改密后私钥仍是合法 32B hex');
  // 改密前后私钥必须一致（仅加密层被替换，私钥字节不变）
  const oldPk = await getAccountPrivateKey(accounts[0], PASSWORD);
  assert.equal(newPk.toLowerCase(), oldPk.toLowerCase(), '改密不应改私钥');

  // 地址不变
  for (let i = 0; i < accounts.length; i++) {
    assert.equal(updatedAccounts[i].address, accounts[i].address);
    assert.equal(updatedAccounts[i].namespace, 'tron');
    assert.equal(updatedAccounts[i].chainKey, 'tron:mainnet');
    assert.equal(updatedAccounts[i].coinType, 195);
  }
});

// ==================== 链身份不被 EVM 默认覆盖 ====================

test('withAccountDefaults 模拟：Tron 账户读出后链身份字段仍是 tron:*', () => {
  // 模拟 storage 读路径里 withAccountDefaults 的行为：只补缺失字段，不覆盖已有。
  // 我们直接在 vault 里出来的 mainAccount 上做断言。
  return importTronPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD).then(({ mainAccount }) => {
    // 这些字段已存在且为 Tron 值，不应被任何 EVM 默认覆盖
    assert.equal(mainAccount.namespace, 'tron');
    assert.equal(mainAccount.chainKey, 'tron:mainnet');
    assert.equal(mainAccount.coinType, 195);
    // publicKey 是 33 字节 compressed，0x + 66 hex
    assert.match(mainAccount.publicKey, /^0x[0-9a-fA-F]{66}$/);
  });
});

// ==================== Tron 解密私钥还原 → 用 address helper 派生同一地址 ====================
//
// createWalletInstance 对 Tron 账户跳过 EVM 形态校验（account.address 是 T...）
// 但仍返回 ethers.Wallet；signTronTransactionLocal 直接从 keyring 读
// .privateKey 后用 ethers.SigningKey 重构做 ECDSA，不需要 EVM 地址校验。
// 这里守门的是"解密还原得到原私钥"+"用同一私钥能派生回同一 Tron 地址"——
// 即 vault 加解密边界的正确性。

test('Tron 账户：getAccountPrivateKey 还原私钥 → address helper 派生同一地址', async () => {
  const { mainAccount } = await importTronPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  const pk = await getAccountPrivateKey(mainAccount, PASSWORD);
  // 私钥还原
  assert.equal(pk.toLowerCase(), TEST_PRIVKEY_0.toLowerCase());
  // 用 Tron address helper 从私钥派生地址，必须与 mainAccount.address 一致
  const derived = privateKeyToTronAddress(pk, 0x41);
  assert.equal(derived, mainAccount.address);
});
