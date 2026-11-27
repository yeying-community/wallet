/**
 * 知行图钱包的助记词:创建时必须保存,导入时没有。
 *
 * 用户的要求是「以后创建时保存助记词」——所以这里守两件事:
 *   1. `createZhixingWallet` 建出来的钱包是 HD 型、存着加密助记词,
 *      而且那串助记词能推回同一个种子(同一个公钥);
 *   2. 私钥/助记词导入的钱包是 IMPORTED 型、**没有**助记词——
 *      界面上的「查看助记词」入口据此隐藏,菜单里给出说明。
 *
 * 助记词是当场随机生成的,只用于断言形状与往返,不落盘。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;

const {
  createZhixingWallet,
  importZhixingMnemonicWallet,
  importZhixingPrivateKeyWallet,
  getWalletMnemonic,
  getAccountPrivateKey,
  WALLET_TYPE
} = await import('../js/background/vault.js');
const { zhixingStandardSeedFromMnemonic, zhixingAddressFromSeed } =
  await import('../js/chain/adapters/zhixing/keys.js');

const PASSWORD = 'Correct-Horse-9';
// 官方 BIP-39 测试向量(全零熵),不是任何真实用户的密钥
const ZERO24 = Array(23).fill('abandon').join(' ') + ' art';

test('createZhixingWallet 存下加密助记词,钱包是 HD 型', async () => {
  const { wallet, mainAccount, mnemonic } = await createZhixingWallet('知行图', PASSWORD);

  assert.equal(wallet.type, WALLET_TYPE.HD, '创建出来的知行图钱包应当是 HD 型(所以有助记词可看)');
  assert.ok(wallet.encryptedMnemonic, '必须保存加密助记词');
  assert.equal(mainAccount.mnemonic, undefined, '明文助记词不得落在账户对象上');

  assert.equal(mnemonic.trim().split(/\s+/).length, 24, '知行图钱包用 24 个词');
  assert.equal(await getWalletMnemonic(wallet, PASSWORD), mnemonic, '存的那串就是生成时的那串');
});

test('createZhixingWallet:存下的助记词能推回同一个种子(同一个公钥)', async () => {
  const { wallet, mainAccount, mnemonic } = await createZhixingWallet('知行图', PASSWORD);

  const seed = await getAccountPrivateKey(mainAccount, PASSWORD);
  assert.equal(seed.toLowerCase(), zhixingStandardSeedFromMnemonic(mnemonic, '', 0).toLowerCase());
  assert.equal(mainAccount.address, zhixingAddressFromSeed(seed), '公钥与助记词推出的种子要对得上');
});

test('createZhixingWallet:错误口令解不开助记词', async () => {
  const { wallet } = await createZhixingWallet('知行图', PASSWORD);
  await assert.rejects(() => getWalletMnemonic(wallet, 'Wrong-Password-8'));
});

test('导入的钱包没有助记词(私钥导入)', async () => {
  const seed = zhixingStandardSeedFromMnemonic(ZERO24, '', 0);
  const { wallet } = await importZhixingPrivateKeyWallet('知行图私钥', seed, PASSWORD);
  assert.equal(wallet.type, WALLET_TYPE.IMPORTED);
  assert.equal(wallet.encryptedMnemonic, undefined, '导入的钱包不该有助记词');
});

test('导入的钱包没有助记词(助记词导入)', async () => {
  const { wallet } = await importZhixingMnemonicWallet('知行图助记词', ZERO24, PASSWORD);
  assert.equal(wallet.type, WALLET_TYPE.IMPORTED);
  assert.equal(wallet.encryptedMnemonic, undefined, '助记词导入时那串词没有再保存一份');
});
