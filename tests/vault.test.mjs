/**
 * vault 层单测（零依赖，Node 内置 test runner）
 * 运行：node --test "tests/*.test.mjs"
 *
 * 覆盖 HD/私钥钱包创建、导入、子账户派生、密钥导出、改密的加解密往返。
 * 使用业界公开的 Hardhat 测试助记词/私钥做确定性断言（仅测试向量，非真实资产）。
 * vault 是私钥进出加密边界的唯一通道，属于资产安全关键路径。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHDWallet,
  importHDWallet,
  importPrivateKeyWallet,
  deriveSubAccount,
  getAccountPrivateKey,
  getWalletMnemonic,
  changeWalletPassword,
  createWalletInstance,
  WALLET_TYPE
} from '../js/background/vault.js';

const PASSWORD = 'Correct-Horse-9';
const WRONG_PASSWORD = 'Correct-Horse-8';

// Hardhat 公开测试向量（公链尽人皆知，无真实资产）
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_ADDR_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_ADDR_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_PRIVKEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('createHDWallet 生成 HD 钱包 + 主账户 + 12 词助记词', async () => {
  const { wallet, mainAccount, mnemonic } = await createHDWallet('Acc 1', PASSWORD);

  assert.equal(wallet.type, WALLET_TYPE.HD);
  assert.ok(wallet.encryptedMnemonic, 'HD 钱包必须保存加密助记词');
  assert.equal(wallet.accountCount, 1);

  assert.equal(mainAccount.type, undefined);
  assert.equal(mainAccount.index, 0);
  assert.equal(mainAccount.derivationPath, "m/44'/60'/0'/0/0");
  assert.match(mainAccount.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(mainAccount.id, `${wallet.id}_0`);

  assert.equal(mnemonic.trim().split(/\s+/).length, 12);
  // 明文助记词不得落在账户对象上
  assert.equal(mainAccount.mnemonic, undefined);
});

test('createWalletInstance 用正确密码可重建同一地址', async () => {
  const { mainAccount } = await createHDWallet('Acc 1', PASSWORD);
  const instance = await createWalletInstance(mainAccount, PASSWORD);
  assert.equal(instance.address.toLowerCase(), mainAccount.address.toLowerCase());
});

test('createWalletInstance 用错误密码必须失败', async () => {
  const { mainAccount } = await createHDWallet('Acc 1', PASSWORD);
  await assert.rejects(() => createWalletInstance(mainAccount, WRONG_PASSWORD));
});

test('importHDWallet 对已知助记词派生确定性地址', async () => {
  const { wallet, mainAccount } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  assert.equal(wallet.type, WALLET_TYPE.HD);
  assert.equal(mainAccount.address.toLowerCase(), TEST_ADDR_0.toLowerCase());
});

test('importHDWallet 拒绝非法助记词', async () => {
  await assert.rejects(() => importHDWallet('Bad', 'not a valid mnemonic phrase at all', PASSWORD));
});

test('importPrivateKeyWallet 对已知私钥得到确定性地址且无助记词', async () => {
  const { wallet, mainAccount } = await importPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  assert.equal(wallet.type, WALLET_TYPE.IMPORTED);
  assert.equal(wallet.encryptedMnemonic, undefined, '导入私钥钱包不应有助记词');
  assert.equal(mainAccount.address.toLowerCase(), TEST_ADDR_0.toLowerCase());
});

test('importPrivateKeyWallet 拒绝非法私钥', async () => {
  await assert.rejects(() => importPrivateKeyWallet('PK', '0x1234', PASSWORD));
});

test('deriveSubAccount 派生确定性子账户地址', async () => {
  const { wallet } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  const sub = await deriveSubAccount(wallet, 1, 'Acc 2', PASSWORD);

  assert.equal(sub.type, undefined);
  assert.equal(sub.index, 1);
  assert.equal(sub.derivationPath, "m/44'/60'/0'/0/1");
  assert.equal(sub.address.toLowerCase(), TEST_ADDR_1.toLowerCase());
  assert.equal(sub.id, `${wallet.id}_1`);
});

test('deriveSubAccount 对导入私钥钱包应拒绝（无助记词不可派生）', async () => {
  const { wallet } = await importPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  await assert.rejects(() => deriveSubAccount(wallet, 1, 'Acc 2', PASSWORD));
});

test('deriveSubAccount 用错误密码应失败', async () => {
  const { wallet } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  await assert.rejects(() => deriveSubAccount(wallet, 1, 'Acc 2', WRONG_PASSWORD));
});

test('getAccountPrivateKey 正确密码还原原私钥', async () => {
  const { mainAccount } = await importPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  const pk = await getAccountPrivateKey(mainAccount, PASSWORD);
  assert.equal(pk.toLowerCase(), TEST_PRIVKEY_0.toLowerCase());
});

test('getWalletMnemonic 还原 HD 助记词，对导入钱包拒绝', async () => {
  const { wallet } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  const mnemonic = await getWalletMnemonic(wallet, PASSWORD);
  assert.equal(mnemonic.trim(), TEST_MNEMONIC);

  const { wallet: pkWallet } = await importPrivateKeyWallet('PK', TEST_PRIVKEY_0, PASSWORD);
  await assert.rejects(() => getWalletMnemonic(pkWallet, PASSWORD));
});

test('changeWalletPassword 重加密后旧密码失效、新密码可用、地址不变', async () => {
  const NEW_PASSWORD = 'Brand-New-Pass-1';
  const { wallet } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  const sub = await deriveSubAccount(wallet, 1, 'Acc 2', PASSWORD);
  const accounts = [
    // 主账户：从助记词重导以拿到 encryptedPrivateKey
    (await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD)).mainAccount,
    sub
  ];

  const { wallet: updatedWallet, accounts: updatedAccounts } =
    await changeWalletPassword(wallet, accounts, PASSWORD, NEW_PASSWORD);

  // 旧密码不能再解密助记词
  await assert.rejects(() => getWalletMnemonic(updatedWallet, PASSWORD));
  // 新密码可解密助记词
  assert.equal((await getWalletMnemonic(updatedWallet, NEW_PASSWORD)).trim(), TEST_MNEMONIC);

  // 账户地址保持不变，且新密码可重建实例
  for (let i = 0; i < accounts.length; i++) {
    assert.equal(updatedAccounts[i].address, accounts[i].address, '改密不应改变地址');
    const instance = await createWalletInstance(updatedAccounts[i], NEW_PASSWORD);
    assert.equal(instance.address.toLowerCase(), accounts[i].address.toLowerCase());
    await assert.rejects(() => createWalletInstance(updatedAccounts[i], PASSWORD));
  }
});

test('changeWalletPassword 用错误旧密码应拒绝', async () => {
  const { wallet, mainAccount } = await importHDWallet('Imported HD', TEST_MNEMONIC, PASSWORD);
  await assert.rejects(
    () => changeWalletPassword(wallet, [mainAccount], WRONG_PASSWORD, 'Brand-New-Pass-1')
  );
});
