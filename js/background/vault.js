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
import { ethers } from '../../lib/ethers-5.7.esm.min.js';
import {
  createInvalidAddressError,
  createInvalidPasswordError,
  createInternalError,
  createMnemonicInvalidError,
  createPrivateKeyInvalidError,
  createInvalidParams,
  createAccountNotFoundError,
} from '../common/errors/index.js';

// ==================== 钱包类型 ====================

export const WALLET_TYPE = {
  HD: 'hd',           // HD 钱包（有助记词）
  IMPORTED: 'imported' // 导入钱包（只有私钥）
};

export const ACCOUNT_TYPE = {
  MAIN: 'main',       // 主账户
  SUB: 'sub'          // 子账户
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

    // 验证地址
    if (wallet.address.toLowerCase() !== account.address.toLowerCase()) {
      throw createInvalidAddressError('解密后的地址与账户地址不匹配');
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
    const mainWallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);

    // 加密助记词和私钥
    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(mainWallet.privateKey, password);

    // 生成钱包 ID
    const walletId = generateId('wallet');

    // 创建钱包对象
    const wallet = {
      id: walletId,
      name: 'HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic: encryptedMnemonic,
      createdAt: getTimestamp(),
      accountCount: 1 // 初始有 1 个账户
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Account 1',
      type: ACCOUNT_TYPE.MAIN,
      index: 0,
      derivationPath: derivationPath,
      address: mainWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      createdAt: getTimestamp()
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
      mainWallet = ethers.Wallet.fromMnemonic(mnemonic.trim(), derivationPath);
    } catch (error) {
      throw createMnemonicInvalidError('无法从助记词派生钱包：' + error.message);
    }

    // 加密助记词和私钥
    const encryptedMnemonic = await encryptString(mnemonic, password);
    const encryptedPrivateKey = await encryptString(mainWallet.privateKey, password);

    // 生成钱包 ID
    const walletId = generateId('wallet');

    // 创建钱包对象
    const wallet = {
      id: walletId,
      name: 'HD Wallet',
      type: WALLET_TYPE.HD,
      encryptedMnemonic: encryptedMnemonic,
      createdAt: getTimestamp(),
      accountCount: 1
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Account 1',
      type: ACCOUNT_TYPE.MAIN,
      index: 0,
      derivationPath: derivationPath,
      address: mainWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      createdAt: getTimestamp()
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

    // 创建钱包对象（无助记词）
    const wallet = {
      id: walletId,
      name: 'Imported Wallet',
      type: WALLET_TYPE.IMPORTED,
      createdAt: getTimestamp(),
      accountCount: 1
    };

    // 创建主账户对象
    const mainAccount = {
      id: generateAccountId(walletId, 0),
      walletId: walletId,
      name: accountName || 'Imported Account',
      type: ACCOUNT_TYPE.MAIN,
      index: 0,
      address: ethersWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      createdAt: getTimestamp()
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
      ethersWallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);
    } catch (error) {
      throw createInternalError('派生账户失败：' + error.message);
    }

    // 加密私钥
    const encryptedPrivateKey = await encryptString(ethersWallet.privateKey, password);

    // 创建子账户对象
    const subAccount = {
      id: generateAccountId(wallet.id, newIndex),
      walletId: wallet.id,
      name: accountName || `Account ${newIndex + 1}`,
      type: ACCOUNT_TYPE.SUB,
      index: newIndex,
      derivationPath: derivationPath,
      address: ethersWallet.address,
      encryptedPrivateKey: encryptedPrivateKey,
      createdAt: getTimestamp()
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
 * @param {string} walletId - 钱包 ID
 * @param {number} index - 账户索引
 * @returns {string} 账户 ID
 */
function generateAccountId(walletId, index) {
  return `${walletId}_${index}`;
}
