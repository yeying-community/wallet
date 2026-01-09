/**
 * YeYing Wallet - 签名操作
 * 负责：交易签名、消息签名、类型化数据签名
 */

import { getWalletInstance } from './keyring.js';
import { state } from './state.js';
import { getNetworkByChainId, getNetworkConfigByKey } from '../storage/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { ethers } from '../../lib/ethers-5.7.esm.min.js';

/**
 * 签名交易
 * @param {string} accountId - 账户 ID
 * @param {Object} transaction - 交易对象
 * @returns {Promise<Object>} 交易哈希和详情
 */
export async function signTransaction(accountId, transaction) {
  try {
    const wallet = getWalletInstance(accountId);

    // 连接到 provider
    const network = await getNetworkByChainId(state.currentChainId);
    let rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc;
    if (!rpcUrl) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
    }
    if (!rpcUrl) {
      throw new Error('RPC URL not configured');
    }
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const connectedWallet = wallet.connect(provider);

    // 签名并发送交易
    const tx = await connectedWallet.sendTransaction(transaction);

    console.log('✅ Transaction signed:', tx.hash);

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value?.toString(),
      nonce: tx.nonce,
      gasLimit: tx.gasLimit?.toString(),
      gasPrice: tx.gasPrice?.toString()
    };

  } catch (error) {
    console.error('❌ Sign transaction failed:', error);
    throw error;
  }
}

/**
 * 签名消息
 * @param {string} accountId - 账户 ID
 * @param {string} message - 要签名的消息
 * @returns {Promise<string>} 签名
 */
export async function signMessage(accountId, message) {
  try {
    const wallet = getWalletInstance(accountId);
    const signature = await wallet.signMessage(message);

    console.log('✅ Message signed');

    return signature;

  } catch (error) {
    console.error('❌ Sign message failed:', error);
    throw error;
  }
}

/**
 * 签名类型化数据
 * @param {string} accountId - 账户 ID
 * @param {Object} domain - 域
 * @param {Object} types - 类型
 * @param {Object} value - 值
 * @returns {Promise<string>} 签名
 */
export async function signTypedData(accountId, domain, types, value) {
  try {
    const wallet = getWalletInstance(accountId);
    const signature = await wallet.signTypedData(domain, types, value);

    console.log('✅ Typed data signed');

    return signature;

  } catch (error) {
    console.error('❌ Sign typed data failed:', error);
    throw error;
  }
}
