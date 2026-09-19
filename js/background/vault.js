/**
 * YeYing Wallet - 密钥库管理模块
 * 职责：管理所有加密的私钥和助记词
 * 
 * 核心概念：
 * - 钱包（Wallet）：一个独立的密钥容器
 *   - HD 钱包：有助记词，可派生子账户
 *   - 导入钱包：只有私钥，无法派生
 * 
 * - 账户（Account）：钱包中的一个地址
 *   - 主账户：钱包的第一个账户（index=0）
 *   - 子账户：从主账户派生的账户（index>0）
 */

import {
  validatePassword,
  encryptString,
  decryptString,
  validateMnemonic,
  validatePrivateKey,
} from '../common/crypto/index.js';
import { generateId } from '../common/utils/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import {
  createInvalidAddressError,
  createInvalidPasswordError,
  createInternalError,
  createMnemonicInvalidError,
  createPrivateKeyInvalidError,
  createInvalidParams,
  createAccountNotFoundError,
} from '../common/errors/index.js';
import {
  DEFAULT_CHAIN_KEY,
  DEFAULT_COIN_TYPE,
  DEFAULT_NAMESPACE
} from '../chain/chain-key.js';
import {
  privateKeyToTronAddress,
  tronPrefixForReference,
  TRON_COIN_TYPE,
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET
} from '../chain/adapters/tron/address.js';
import {
  privateKeyToSolanaAddress,
  SOLANA_COIN_TYPE,
  SOLANA_NAMESPACE,
  SOLANA_REFERENCE_MAINNET
} from '../chain/adapters/solana/address.js';
import {
  privateKeyToBitcoinAddress
} from '../chain/adapters/bip122/address.js';
import {
  BIP122_NAMESPACE,
  BIP122_COIN_TYPE,
  BIP122_REFERENCE_MAINNET,
  BIP122_REFERENCE_TESTNET
} from '../chain/adapters/bip122/chain-key-bridge.js';

// ==================== 钱包类型 ====================

export const WALLET_TYPE = {
  HD: 'hd',           // HD 钱包（有助记词）
  IMPORTED: 'imported' // 导入钱包（只有私钥）
};

// ==================== 钱包创建 ====================

/**
 * 创建钱包实例（从账户对象）
 * @param {Object} account - 账户对象
 * @param {string} password - 密码
 * @returns {Promise<ethers.Wallet>} Wallet 实例
 */
export async function createWalletInstance(account, password) {
  try {
    // 解密私钥
    const decryptedPrivateKey = await decryptString(account.encryptedPrivateKey, password);

    // 创建钱包实例
    const wallet = new ethers.Wallet(decryptedPrivateKey);

    // 验证地址：仅当账户是 EVM 形态（0x...）时才做 EVM 校验；Tron 账户的
    // account.address 是 Base58Check（T...），与 ethers 推出的 EVM 地址属于
    // 不同编码体系，不能直接比较。Tron 路径的解密还原正确性由
    // getAccountPrivateKey + address helper 的单元测试
    // （tests/tron-vault.test.mjs）守门；返回的 ethers.Wallet 仍可被
    // signing-service.js:signTronTransactionLocal 读取 .privateKey 后用
    // ethers.SigningKey 重做 secp256k1 ECDSA（两条链同曲线，私钥字节等价）。
    if (account.namespace !== 'tron') {
      if (wallet.address.toLowerCase() !== account.address.toLowerCase()) {
        throw createInvalidAddressError('解密后的地址与账户地址不匹配');
      }
    }

    return wallet;

  } catch (error) {
    console.error('❌ Create wallet instance failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成密码错误
    throw createInvalidPasswordError('密码错误或数据损坏');
  }
}

/**
 * 创建 HD 钱包（生成助记词）
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @returns {Promise<Object>} { wallet, mainAccount, mnemonic }
 */
export async function createHDWallet(accountName, password) {
  try {
    // 验证密码
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    // 生成助记词
    const ethersWallet = ethers.Wallet.createRandom();
    const mnemonic = ethersWallet.mnemonic.phrase;

    // 派生第一个账户（主账户）
    const derivationPath = "m/44'/60'/0'/0/0";
    const mainWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);

    // 加密助记词和私钥
    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(mainWallet.privateKey, password);

    // 生成钱包 ID
    const walletId = generateId('wallet');

    const createdAt = getTimestamp();

    // 创建钱包对象
    const wallet = {
      id: walletId,
      name: 'HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic: encryptedMnemonic,
      createdAt,
      accountCount: 1 // 初始有 1 个账户
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Account 1',
      index: 0,
      derivationPath: derivationPath,
      address: mainWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      ...buildEvmAccountIdentity(mainWallet),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ HD Wallet created:', {
      walletId,
      address: mainAccount.address
    });

    return {
      wallet,
      mainAccount,
      mnemonic // 返回助记词供用户备份
    };

  } catch (error) {
    console.error('❌ Create HD wallet failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成内部错误
    throw createInternalError('创建钱包失败：' + error.message);
  }
}

/**
 * 导入 HD 钱包（从助记词）
 * @param {string} accountName - 账户名称
 * @param {string} mnemonic - 助记词
 * @param {string} password - 密码
 * @returns {Promise<Object>} { wallet, mainAccount }
 */
export async function importHDWallet(accountName, mnemonic, password) {
  try {
    // 验证密码
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    // 验证助记词
    validation = validateMnemonic(mnemonic);
    if (!validation.valid) {
      throw createMnemonicInvalidError('助记词无效：' + validation.error);
    }

    // 派生第一个账户
    const derivationPath = "m/44'/60'/0'/0/0";
    let mainWallet;

    try {
      mainWallet = ethers.HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, derivationPath);
    } catch (error) {
      throw createMnemonicInvalidError('无法从助记词派生钱包：' + error.message);
    }

    // 加密助记词和私钥
    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(mainWallet.privateKey, password);

    // 生成钱包 ID
    const walletId = generateId('wallet');

    const createdAt = getTimestamp();

    // 创建钱包对象
    const wallet = {
      id: walletId,
      name: 'HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic: encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Account 1',
      index: 0,
      derivationPath: derivationPath,
      address: mainWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      ...buildEvmAccountIdentity(mainWallet),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ HD Wallet imported:', {
      walletId,
      address: mainAccount.address
    });

    return {
      wallet,
      mainAccount
    };

  } catch (error) {
    console.error('❌ Import HD wallet failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成内部错误
    throw createInternalError('导入钱包失败：' + error.message);
  }
}

/**
 * 导入私钥钱包
 * @param {string} accountName - 账户名称
 * @param {string} privateKey - 私钥
 * @param {string} password - 密码
 * @returns {Promise<Object>} { wallet, mainAccount }
 */
export async function importPrivateKeyWallet(accountName, privateKey, password) {
  try {
    // 验证密码
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    // 验证私钥
    validation = validatePrivateKey(privateKey);
    if (!validation.valid) {
      throw createPrivateKeyInvalidError('私钥无效：' + validation.error);
    }

    // 清理私钥格式
    privateKey = privateKey.trim();
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    // 从私钥创建钱包
    let ethersWallet;
    try {
      ethersWallet = new ethers.Wallet(privateKey);
    } catch (error) {
      throw createPrivateKeyInvalidError('无法从私钥创建钱包：' + error.message);
    }

    // 加密私钥
    const encryptedPrivateKey = await encryptString(privateKey, password);

    // 生成钱包 ID
    const walletId = generateId('wallet');

    const createdAt = getTimestamp();

    // 创建钱包对象（无助记词）
    const wallet = {
      id: walletId,
      name: 'Imported Wallet',
      type: WALLET_TYPE.IMPORTED,
      createdAt,
      accountCount: 1
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Imported Account',
      index: 0,
      address: ethersWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      ...buildEvmAccountIdentity(ethersWallet),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Private key wallet imported:', {
      walletId,
      address: mainAccount.address
    });

    return {
      wallet,
      mainAccount
    };

  } catch (error) {
    console.error('❌ Import private key wallet failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成内部错误
    throw createInternalError('导入私钥失败：' + error.message);
  }
}

// ==================== 账户派生 ====================

/**
 * 派生子账户（仅 HD 钱包）
 * @param {Object} wallet - 钱包对象
 * @param {number} newIndex - 新账户索引
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @returns {Promise<Object>} 子账户对象
 */
export async function deriveSubAccount(wallet, newIndex, accountName, password) {
  try {
    // 检查钱包类型
    if (wallet.type !== WALLET_TYPE.HD) {
      throw createInvalidParams('只有 HD 钱包可以派生子账户');
    }

    // 检查是否有助记词
    if (!wallet.encryptedMnemonic) {
      throw createMnemonicInvalidError('钱包缺少助记词数据');
    }

    // 解密助记词
    let mnemonic;
    try {
      mnemonic = await decryptString(wallet.encryptedMnemonic, password);
    } catch (error) {
      throw createInvalidPasswordError('密码错误');
    }

    // 派生新账户
    const derivationPath = `m/44'/60'/0'/0/${newIndex}`;
    let ethersWallet;

    try {
      ethersWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
    } catch (error) {
      throw createInternalError('派生账户失败：' + error.message);
    }

    // 加密私钥
    const encryptedPrivateKey = await encryptString(ethersWallet.privateKey, password);

    const createdAt = getTimestamp();

    // 创建子账户对象
    const subAccount = {
      id: generateAccountId(wallet.id, newIndex),
      walletId: wallet.id,
      name: accountName || `Account ${newIndex + 1}`,
      index: newIndex,
      derivationPath: derivationPath,
      address: ethersWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      ...buildEvmAccountIdentity(ethersWallet),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Sub account derived:', {
      walletId: wallet.id,
      index: newIndex,
      address: subAccount.address
    });

    return subAccount;

  } catch (error) {
    console.error('❌ Derive sub account failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成内部错误
    throw createInternalError('派生子账户失败：' + error.message);
  }
}

// ==================== 私钥和助记词获取 ====================

/**
 * 获取账户的私钥
 * @param {Object} account - 账户对象
 * @param {string} password - 密码
 * @returns {Promise<string>} 明文私钥
 */
export async function getAccountPrivateKey(account, password) {
  try {
    if (!account.encryptedPrivateKey) {
      throw createPrivateKeyInvalidError('账户缺少私钥数据');
    }

    const privateKey = await decryptString(account.encryptedPrivateKey, password);
    return privateKey;

  } catch (error) {
    console.error('❌ Get account private key failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成密码错误
    throw createInvalidPasswordError('密码错误或数据损坏');
  }
}

/**
 * 获取钱包的助记词
 * @param {Object} wallet - 钱包对象
 * @param {string} password - 密码
 * @returns {Promise<string>} 明文助记词
 */
export async function getWalletMnemonic(wallet, password) {
  try {
    // 检查钱包类型
    if (wallet.type !== WALLET_TYPE.HD) {
      throw createInvalidParams('该钱包没有助记词（非 HD 钱包）');
    }

    // 检查是否有助记词
    if (!wallet.encryptedMnemonic) {
      throw createMnemonicInvalidError('钱包缺少助记词数据');
    }

    // 解密助记词
    const mnemonic = await decryptString(wallet.encryptedMnemonic, password);
    return mnemonic;

  } catch (error) {
    console.error('❌ Get wallet mnemonic failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成密码错误
    throw createInvalidPasswordError('密码错误或数据损坏');
  }
}

// ==================== 密码修改 ====================

/**
 * 修改钱包密码
 * @param {Object} wallet - 钱包对象
 * @param {Array<Object>} accounts - 该钱包的所有账户
 * @param {string} oldPassword - 旧密码
 * @param {string} newPassword - 新密码
 * @returns {Promise<Object>} { wallet, accounts }
 */
export async function changeWalletPassword(wallet, accounts, oldPassword, newPassword) {
  try {
    // 验证新密码
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      throw createInvalidPasswordError('新密码不符合要求：' + validation.error);
    }

    // 验证账户数组
    if (!accounts || accounts.length === 0) {
      throw createAccountNotFoundError('没有账户需要更新');
    }

    // 验证旧密码（通过解密助记词或第一个账户的私钥）
    try {
      if (wallet.type === WALLET_TYPE.HD && wallet.encryptedMnemonic) {
        await decryptString(wallet.encryptedMnemonic, oldPassword);
      } else {
        await decryptString(accounts[0].encryptedPrivateKey, oldPassword);
      }
    } catch (error) {
      throw createInvalidPasswordError('旧密码错误');
    }

    // 重新加密钱包数据
    const updatedWallet = { ...wallet };
    if (wallet.type === WALLET_TYPE.HD && wallet.encryptedMnemonic) {
      const mnemonic = await decryptString(wallet.encryptedMnemonic, oldPassword);
      updatedWallet.encryptedMnemonic = await encryptString(mnemonic, newPassword);
    }

    // 重新加密所有账户的私钥
    const updatedAccounts = [];
    for (const account of accounts) {
      const privateKey = await decryptString(account.encryptedPrivateKey, oldPassword);
      const encryptedPrivateKey = await encryptString(privateKey, newPassword);

      updatedAccounts.push({
        ...account,
        encryptedPrivateKey
      });
    }

    console.log('✅ Wallet password changed:', wallet.id);

    return {
      wallet: updatedWallet,
      accounts: updatedAccounts
    };

  } catch (error) {
    console.error('❌ Change wallet password failed:', error);

    // 如果是我们自己的错误，直接抛出
    if (error.code) {
      throw error;
    }

    // 否则包装成内部错误
    throw createInternalError('修改密码失败：' + error.message);
  }
}

// ==================== 工具函数 ====================

/**
 * 生成账户 ID
 * @param {string} walletId
 * @param {number} index
 * @returns {string}
 */
function generateAccountId(walletId, index) {
  return `${walletId}_${index}`;
}

/**
 * 推导账户的链身份字段（namespace/chainKey/coinType/publicKey）。
 *
 * `chainFamily` 控制命名空间：
 *   - 'eip155' → namespace=eip155, chainKey=DEFAULT_CHAIN_KEY, coinType=60；
 *   - 'tron'   → namespace=tron, chainKey=tron:<reference>, coinType=195，
 *                address 由 privateKeyToTronAddress 派生为 T... 形态（Base58Check）。
 *   - 'solana' → namespace=solana, chainKey=solana:<reference>, coinType=501，
 *                address 由 privateKeyToSolanaAddress 派生（base58 32B ed25519 pubkey）。
 *                publicKey 字段为 ed25519 pubkey bytes（base58 编码，无 0x04 前缀）。
 *
 * 注意：`buildEvmAccountIdentity` 保留为旧入口（薄包装），新逻辑都走这里。
 *
 * @param {ethers.HDNodeWallet|ethers.Wallet} ethersWallet
 * @param {string} [chainFamily='eip155']
 * @param {{tronReference?: string, solanaReference?: string, bip122Reference?: string}} [options]
 * @returns {{namespace:string,chainKey:string,coinType:number,publicKey:string}}
 */
function buildAccountIdentity(ethersWallet, chainFamily = DEFAULT_NAMESPACE, options = {}) {
  const family = String(chainFamily || DEFAULT_NAMESPACE).toLowerCase();

  if (family === TRON_NAMESPACE) {
    const reference = String(options.tronReference || TRON_REFERENCE_MAINNET).toLowerCase();
    const publicKey = ethers.SigningKey.computePublicKey(ethersWallet.privateKey, true);
    return {
      namespace: TRON_NAMESPACE,
      chainKey: `${TRON_NAMESPACE}:${reference}`,
      coinType: TRON_COIN_TYPE,
      publicKey
    };
  }

  if (family === SOLANA_NAMESPACE) {
    const reference = String(options.solanaReference || SOLANA_REFERENCE_MAINNET).toLowerCase();
    // Solana pubkey 走 ed25519（base58(32B)），不复用 secp256k1 的 uncompressed 形态
    const solPubkey = privateKeyToSolanaAddress(ethersWallet.privateKey);
    return {
      namespace: SOLANA_NAMESPACE,
      chainKey: `${SOLANA_NAMESPACE}:${reference}`,
      coinType: SOLANA_COIN_TYPE,
      publicKey: solPubkey
    };
  }

  if (family === BIP122_NAMESPACE) {
    const reference = String(options.bip122Reference || BIP122_REFERENCE_MAINNET).toLowerCase();
    // BTC 复用 secp256k1 压缩公钥（33B hex）；地址是 P2WPKH，公钥字段存压缩 hex 供 witness。
    const publicKey = ethers.SigningKey.computePublicKey(ethersWallet.privateKey, true);
    return {
      namespace: BIP122_NAMESPACE,
      chainKey: `${BIP122_NAMESPACE}:${reference}`,
      coinType: BIP122_COIN_TYPE,
      publicKey
    };
  }

  const publicKey = ethers.SigningKey.computePublicKey(ethersWallet.privateKey, true);
  return {
    namespace: DEFAULT_NAMESPACE,
    chainKey: DEFAULT_CHAIN_KEY,
    coinType: DEFAULT_COIN_TYPE,
    publicKey
  };
}

/**
 * EVM 账户的链身份字段（旧入口薄包装，保留以避免破坏旧 caller）。
 * @param {ethers.HDNodeWallet|ethers.Wallet} ethersWallet
 * @returns {{namespace:string,chainKey:string,coinType:number,publicKey:string}}
 */
function buildEvmAccountIdentity(ethersWallet) {
  return buildAccountIdentity(ethersWallet, DEFAULT_NAMESPACE);
}

// ==================== Tron 钱包（v1：secp256k1 / native TRX） ====================
//
// 4 个入口点与 EVM 路径平行：HD 创建、HD 导入、私钥导入、子账户派生。
// 派生路径固定 m/44'/195'/0'/0/{index}；地址走 Base58Check（T... 形态）。
// reference 默认 mainnet（0x41 prefix），可通过 options 切换 shasta/nile。

/**
 * 创建 Tron HD 钱包（生成新助记词）
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @param {{tronReference?: string}} [options]
 * @returns {Promise<Object>} { wallet, mainAccount, mnemonic }
 */
export async function createTronHDWallet(accountName, password, options = {}) {
  try {
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    const reference = String(options.tronReference || TRON_REFERENCE_MAINNET).toLowerCase();
    const prefix = tronPrefixForReference(reference);

    const ethersWallet = ethers.Wallet.createRandom();
    const mnemonic = ethersWallet.mnemonic.phrase;

    // 直接从私钥派生主账户（HDNodeWallet 的默认 path 是 EVM，需绕开）
    const childSk = deriveTronChildKeyFromMnemonic(mnemonic, 0);
    const childAddress = privateKeyToTronAddress(childSk, prefix);

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Tron HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Tron Account 1',
      index: 0,
      derivationPath: `m/44'/195'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), TRON_NAMESPACE, { tronReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Tron HD Wallet created:', { walletId, address: mainAccount.address, reference });

    return { wallet, mainAccount, mnemonic };
  } catch (error) {
    console.error('❌ Create Tron HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('创建 Tron 钱包失败：' + error.message);
  }
}

/**
 * 导入 Tron HD 钱包（从助记词）
 * @param {string} accountName - 账户名称
 * @param {string} mnemonic - 助记词
 * @param {string} password - 密码
 * @param {{tronReference?: string}} [options]
 * @returns {Promise<Object>} { wallet, mainAccount }
 */
export async function importTronHDWallet(accountName, mnemonic, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validateMnemonic(mnemonic);
    if (!validation.valid) {
      throw createMnemonicInvalidError('助记词无效：' + validation.error);
    }

    const reference = String(options.tronReference || TRON_REFERENCE_MAINNET).toLowerCase();
    const prefix = tronPrefixForReference(reference);

    let childSk;
    try {
      childSk = deriveTronChildKeyFromMnemonic(mnemonic.trim(), 0);
    } catch (error) {
      throw createMnemonicInvalidError('无法从助记词派生 Tron 钱包：' + error.message);
    }
    const childAddress = privateKeyToTronAddress(childSk, prefix);

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Tron HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Tron Account 1',
      index: 0,
      derivationPath: `m/44'/195'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), TRON_NAMESPACE, { tronReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Tron HD Wallet imported:', { walletId, address: mainAccount.address, reference });

    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Tron HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Tron 钱包失败：' + error.message);
  }
}

/**
 * 导入 Tron 私钥钱包
 * @param {string} accountName - 账户名称
 * @param {string} privateKey - 私钥
 * @param {string} password - 密码
 * @param {{tronReference?: string}} [options]
 * @returns {Promise<Object>} { wallet, mainAccount }
 */
export async function importTronPrivateKeyWallet(accountName, privateKey, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validatePrivateKey(privateKey);
    if (!validation.valid) {
      throw createPrivateKeyInvalidError('私钥无效：' + validation.error);
    }

    privateKey = privateKey.trim();
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    let ethersWallet;
    try {
      ethersWallet = new ethers.Wallet(privateKey);
    } catch (error) {
      throw createPrivateKeyInvalidError('无法从私钥创建 Tron 钱包：' + error.message);
    }

    const reference = String(options.tronReference || TRON_REFERENCE_MAINNET).toLowerCase();
    const prefix = tronPrefixForReference(reference);
    const tronAddress = privateKeyToTronAddress(ethersWallet.privateKey, prefix);

    const encryptedPrivateKey = await encryptString(privateKey, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Imported Tron Wallet',
      type: WALLET_TYPE.IMPORTED,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Imported Tron Account',
      index: 0,
      address: tronAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(ethersWallet, TRON_NAMESPACE, { tronReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Tron private key wallet imported:', { walletId, address: mainAccount.address, reference });

    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Tron private key wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Tron 私钥失败：' + error.message);
  }
}

/**
 * 派生 Tron 子账户（仅 HD 钱包）
 * @param {Object} wallet - HD 钱包对象
 * @param {number} newIndex - 新账户索引
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @param {{tronReference?: string}} [options]
 * @returns {Promise<Object>} 子账户对象
 */
export async function deriveTronSubAccount(wallet, newIndex, accountName, password, options = {}) {
  try {
    if (wallet.type !== WALLET_TYPE.HD) {
      throw createInvalidParams('只有 HD 钱包可以派生 Tron 子账户');
    }
    if (!wallet.encryptedMnemonic) {
      throw createMnemonicInvalidError('钱包缺少助记词数据');
    }

    let mnemonic;
    try {
      mnemonic = await decryptString(wallet.encryptedMnemonic, password);
    } catch (error) {
      throw createInvalidPasswordError('密码错误');
    }

    const reference = String(options.tronReference || TRON_REFERENCE_MAINNET).toLowerCase();
    const prefix = tronPrefixForReference(reference);

    let childSk;
    try {
      childSk = deriveTronChildKeyFromMnemonic(mnemonic, newIndex);
    } catch (error) {
      throw createInternalError('派生 Tron 账户失败：' + error.message);
    }
    const childAddress = privateKeyToTronAddress(childSk, prefix);

    const encryptedPrivateKey = await encryptString(childSk, password);
    const createdAt = getTimestamp();

    const subAccount = {
      id: generateAccountId(wallet.id, newIndex),
      walletId: wallet.id,
      name: accountName || `Tron Account ${newIndex + 1}`,
      index: newIndex,
      derivationPath: `m/44'/195'/0'/0/${newIndex}`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), TRON_NAMESPACE, { tronReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Tron sub account derived:', { walletId: wallet.id, index: newIndex, address: subAccount.address });

    return subAccount;
  } catch (error) {
    console.error('❌ Derive Tron sub account failed:', error);
    if (error.code) throw error;
    throw createInternalError('派生 Tron 子账户失败：' + error.message);
  }
}

/**
 * 通过 HDNodeWallet 从 mnemonic 派生 m/44'/195'/0'/0/{index} 的子私钥 hex。
 * ethers.HDNodeWallet.fromPhrase 默认路径是 EVM (m/44'/60'/0'/0/0)，所以用
 * derivePath 走相对路径 44'/195'/0'/0/{index} 即可。
 *
 * @param {string} mnemonic
 * @param {number} index
 * @returns {string} 0x + 64 hex chars
 */
function deriveTronChildKeyFromMnemonic(mnemonic, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(String(mnemonic || '').trim());
  return hd.derivePath(`44'/195'/0'/0/${index}`).privateKey;
}

// ==================== Solana 钱包（v1：ed25519 / native SOL） ====================
//
// 4 个入口点与 EVM / Tron 路径平行：HD 创建、HD 导入、私钥导入、子账户派生。
// 派生路径 m/44'/501'/<account>'/0'/<index>（SLIP-44 / SLIP-0010）。
// v1 简化：私钥字节直接复用 secp256k1 sk 的 32B 字节作为 ed25519 seed（无 SLIP-0010
// ed25519 HD），钱包文档化此限制。地址 = base58(32B ed25519 pubkey)。

/**
 * @param {string} mnemonic
 * @param {number} [account=0]
 * @param {number} [index=0]
 * @returns {string} 0x + 64 hex chars
 */
function deriveSolanaChildKeyFromMnemonic(mnemonic, account = 0, index = 0) {
  const hd = ethers.HDNodeWallet.fromPhrase(String(mnemonic || '').trim());
  return hd.derivePath(`44'/501'/${account}'/0'/${index}`).privateKey;
}

/**
 * 创建 Solana HD 钱包（生成新助记词）
 * @param {string} accountName
 * @param {string} password
 * @param {{solanaReference?: string}} [options]
 */
export async function createSolanaHDWallet(accountName, password, options = {}) {
  try {
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    const reference = String(options.solanaReference || SOLANA_REFERENCE_MAINNET).toLowerCase();

    const ethersWallet = ethers.Wallet.createRandom();
    const mnemonic = ethersWallet.mnemonic.phrase;

    // 直接从私钥派生主账户（HDNodeWallet 默认走 EVM）
    const childSk = deriveSolanaChildKeyFromMnemonic(mnemonic, 0, 0);
    const childAddress = privateKeyToSolanaAddress(childSk);   // 去掉 0x

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Solana HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Solana Account 1',
      index: 0,
      derivationPath: `m/44'/501'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), SOLANA_NAMESPACE, { solanaReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Solana HD Wallet created:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount, mnemonic };
  } catch (error) {
    console.error('❌ Create Solana HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('创建 Solana 钱包失败：' + error.message);
  }
}

/**
 * 导入 Solana HD 钱包（从助记词）
 */
export async function importSolanaHDWallet(accountName, mnemonic, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validateMnemonic(mnemonic);
    if (!validation.valid) {
      throw createMnemonicInvalidError('助记词无效：' + validation.error);
    }

    const reference = String(options.solanaReference || SOLANA_REFERENCE_MAINNET).toLowerCase();

    let childSk;
    try {
      childSk = deriveSolanaChildKeyFromMnemonic(mnemonic.trim(), 0, 0);
    } catch (error) {
      throw createMnemonicInvalidError('无法从助记词派生 Solana 钱包：' + error.message);
    }
    const childAddress = privateKeyToSolanaAddress(childSk);

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Solana HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Solana Account 1',
      index: 0,
      derivationPath: `m/44'/501'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), SOLANA_NAMESPACE, { solanaReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Solana HD Wallet imported:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Solana HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Solana 钱包失败：' + error.message);
  }
}

/**
 * 导入 Solana 私钥钱包
 */
export async function importSolanaPrivateKeyWallet(accountName, privateKey, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validatePrivateKey(privateKey);
    if (!validation.valid) {
      throw createPrivateKeyInvalidError('私钥无效：' + validation.error);
    }

    privateKey = privateKey.trim();
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    let ethersWallet;
    try {
      ethersWallet = new ethers.Wallet(privateKey);
    } catch (error) {
      throw createPrivateKeyInvalidError('无法从私钥创建 Solana 钱包：' + error.message);
    }

    const reference = String(options.solanaReference || SOLANA_REFERENCE_MAINNET).toLowerCase();
    const solAddress = privateKeyToSolanaAddress(ethersWallet.privateKey);

    const encryptedPrivateKey = await encryptString(privateKey, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Imported Solana Wallet',
      type: WALLET_TYPE.IMPORTED,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Imported Solana Account',
      index: 0,
      address: solAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(ethersWallet, SOLANA_NAMESPACE, { solanaReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Solana private key wallet imported:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Solana private key wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Solana 私钥失败：' + error.message);
  }
}

/**
 * 派生 Solana 子账户
 */
export async function deriveSolanaSubAccount(wallet, newIndex, accountName, password, options = {}) {
  try {
    if (wallet.type !== WALLET_TYPE.HD) {
      throw createInvalidParams('只有 HD 钱包可以派生 Solana 子账户');
    }
    if (!wallet.encryptedMnemonic) {
      throw createMnemonicInvalidError('钱包缺少助记词数据');
    }

    let mnemonic;
    try {
      mnemonic = await decryptString(wallet.encryptedMnemonic, password);
    } catch (error) {
      throw createInvalidPasswordError('密码错误');
    }

    const reference = String(options.solanaReference || SOLANA_REFERENCE_MAINNET).toLowerCase();

    let childSk;
    try {
      childSk = deriveSolanaChildKeyFromMnemonic(mnemonic, 0, newIndex);
    } catch (error) {
      throw createInternalError('派生 Solana 账户失败：' + error.message);
    }
    const childAddress = privateKeyToSolanaAddress(childSk);

    const encryptedPrivateKey = await encryptString(childSk, password);
    const createdAt = getTimestamp();

    const subAccount = {
      id: generateAccountId(wallet.id, newIndex),
      walletId: wallet.id,
      name: accountName || `Solana Account ${newIndex + 1}`,
      index: newIndex,
      derivationPath: `m/44'/501'/0'/0/${newIndex}`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), SOLANA_NAMESPACE, { solanaReference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Solana sub account derived:', { walletId: wallet.id, index: newIndex, address: subAccount.address });
    return subAccount;
  } catch (error) {
    console.error('❌ Derive Solana sub account failed:', error);
    if (error.code) throw error;
    throw createInternalError('派生 Solana 子账户失败：' + error.message);
  }
}

// ==================== Bitcoin 钱包（v1：secp256k1 / native BTC P2WPKH） ====================
//
// 4 个入口点与 EVM/Tron/Solana 路径平行。BTC 复用 secp256k1 曲线（同 EVM keyring），
// 派生路径 m/44'/0'/0'/0/{index}（mainnet）/ m/44'/1'/0'/0/{index}（testnet, coinType 1'）。
// 地址走 native segwit P2WPKH（bc1q... / tb1q...）。reference 默认 mainnet。

/**
 * BTC coinType：mainnet 用 0'，testnet 用 1'（SLIP-44）。
 * @param {string} reference
 */
function bitcoinDerivationCoinType(reference) {
  return reference === BIP122_REFERENCE_TESTNET ? 1 : 0;
}

/**
 * @param {string} mnemonic
 * @param {number} index
 * @param {string} reference
 * @returns {string} 0x + 64 hex chars
 */
function deriveBitcoinChildKeyFromMnemonic(mnemonic, index, reference) {
  const hd = ethers.HDNodeWallet.fromPhrase(String(mnemonic || '').trim());
  const coin = bitcoinDerivationCoinType(reference);
  return hd.derivePath(`44'/${coin}'/0'/0/${index}`).privateKey;
}

/**
 * 创建 Bitcoin HD 钱包（生成新助记词）
 * @param {string} accountName
 * @param {string} password
 * @param {{bip122Reference?: string}} [options]
 */
export async function createBitcoinHDWallet(accountName, password, options = {}) {
  try {
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }

    const reference = String(options.bip122Reference || BIP122_REFERENCE_MAINNET).toLowerCase();
    const coin = bitcoinDerivationCoinType(reference);

    const ethersWallet = ethers.Wallet.createRandom();
    const mnemonic = ethersWallet.mnemonic.phrase;

    const childSk = deriveBitcoinChildKeyFromMnemonic(mnemonic, 0, reference);
    const childAddress = privateKeyToBitcoinAddress(childSk, reference);

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Bitcoin HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Bitcoin Account 1',
      index: 0,
      derivationPath: `m/44'/${coin}'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), BIP122_NAMESPACE, { bip122Reference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Bitcoin HD Wallet created:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount, mnemonic };
  } catch (error) {
    console.error('❌ Create Bitcoin HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('创建 Bitcoin 钱包失败：' + error.message);
  }
}

/**
 * 导入 Bitcoin HD 钱包（从助记词）
 * @param {string} accountName
 * @param {string} mnemonic
 * @param {string} password
 * @param {{bip122Reference?: string}} [options]
 */
export async function importBitcoinHDWallet(accountName, mnemonic, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validateMnemonic(mnemonic);
    if (!validation.valid) {
      throw createMnemonicInvalidError('助记词无效：' + validation.error);
    }

    const reference = String(options.bip122Reference || BIP122_REFERENCE_MAINNET).toLowerCase();
    const coin = bitcoinDerivationCoinType(reference);

    let childSk;
    try {
      childSk = deriveBitcoinChildKeyFromMnemonic(mnemonic.trim(), 0, reference);
    } catch (error) {
      throw createMnemonicInvalidError('无法从助记词派生 Bitcoin 钱包：' + error.message);
    }
    const childAddress = privateKeyToBitcoinAddress(childSk, reference);

    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(childSk, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Bitcoin HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Bitcoin Account 1',
      index: 0,
      derivationPath: `m/44'/${coin}'/0'/0/0`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), BIP122_NAMESPACE, { bip122Reference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Bitcoin HD Wallet imported:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Bitcoin HD wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Bitcoin 钱包失败：' + error.message);
  }
}

/**
 * 导入 Bitcoin 私钥钱包
 * @param {string} accountName
 * @param {string} privateKey
 * @param {string} password
 * @param {{bip122Reference?: string}} [options]
 */
export async function importBitcoinPrivateKeyWallet(accountName, privateKey, password, options = {}) {
  try {
    let validation = validatePassword(password);
    if (!validation.valid) {
      throw createInvalidPasswordError(validation.error);
    }
    validation = validatePrivateKey(privateKey);
    if (!validation.valid) {
      throw createPrivateKeyInvalidError('私钥无效：' + validation.error);
    }

    privateKey = privateKey.trim();
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    let ethersWallet;
    try {
      ethersWallet = new ethers.Wallet(privateKey);
    } catch (error) {
      throw createPrivateKeyInvalidError('无法从私钥创建 Bitcoin 钱包：' + error.message);
    }

    const reference = String(options.bip122Reference || BIP122_REFERENCE_MAINNET).toLowerCase();
    const bitcoinAddress = privateKeyToBitcoinAddress(ethersWallet.privateKey, reference);

    const encryptedPrivateKey = await encryptString(privateKey, password);
    const walletId = generateId('wallet');
    const createdAt = getTimestamp();

    const wallet = {
      id: walletId,
      name: 'Imported Bitcoin Wallet',
      type: WALLET_TYPE.IMPORTED,
      createdAt,
      accountCount: 1
    };

    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId,
      name: accountName || 'Imported Bitcoin Account',
      index: 0,
      address: bitcoinAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(ethersWallet, BIP122_NAMESPACE, { bip122Reference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Bitcoin private key wallet imported:', { walletId, address: mainAccount.address, reference });
    return { wallet, mainAccount };
  } catch (error) {
    console.error('❌ Import Bitcoin private key wallet failed:', error);
    if (error.code) throw error;
    throw createInternalError('导入 Bitcoin 私钥失败：' + error.message);
  }
}

/**
 * 派生 Bitcoin 子账户（仅 HD 钱包）
 * @param {Object} wallet
 * @param {number} newIndex
 * @param {string} accountName
 * @param {string} password
 * @param {{bip122Reference?: string}} [options]
 */
export async function deriveBitcoinSubAccount(wallet, newIndex, accountName, password, options = {}) {
  try {
    if (wallet.type !== WALLET_TYPE.HD) {
      throw createInvalidParams('只有 HD 钱包可以派生 Bitcoin 子账户');
    }
    if (!wallet.encryptedMnemonic) {
      throw createMnemonicInvalidError('钱包缺少助记词数据');
    }

    let mnemonic;
    try {
      mnemonic = await decryptString(wallet.encryptedMnemonic, password);
    } catch (error) {
      throw createInvalidPasswordError('密码错误');
    }

    const reference = String(options.bip122Reference || BIP122_REFERENCE_MAINNET).toLowerCase();
    const coin = bitcoinDerivationCoinType(reference);

    let childSk;
    try {
      childSk = deriveBitcoinChildKeyFromMnemonic(mnemonic, newIndex, reference);
    } catch (error) {
      throw createInternalError('派生 Bitcoin 账户失败：' + error.message);
    }
    const childAddress = privateKeyToBitcoinAddress(childSk, reference);

    const encryptedPrivateKey = await encryptString(childSk, password);
    const createdAt = getTimestamp();

    const subAccount = {
      id: generateAccountId(wallet.id, newIndex),
      walletId: wallet.id,
      name: accountName || `Bitcoin Account ${newIndex + 1}`,
      index: newIndex,
      derivationPath: `m/44'/${coin}'/0'/0/${newIndex}`,
      address: childAddress,
      encryptedPrivateKey,
      ...buildAccountIdentity(new ethers.Wallet(childSk), BIP122_NAMESPACE, { bip122Reference: reference }),
      createdAt,
      nameUpdatedAt: createdAt
    };

    console.log('✅ Bitcoin sub account derived:', { walletId: wallet.id, index: newIndex, address: subAccount.address });
    return subAccount;
  } catch (error) {
    console.error('❌ Derive Bitcoin sub account failed:', error);
    if (error.code) throw error;
    throw createInternalError('派生 Bitcoin 子账户失败：' + error.message);
  }
}
