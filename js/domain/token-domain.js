/**
 * 通证域 - 封装通证相关操作
 *
 * 职责：
 * 1. 获取通证余额列表
 * 2. 添加通证
 *
 * 通信协议：{ type, data }
 */

import { WalletMessageType } from '../protocol/protocol.js';
import { BaseDomain } from './base-domain.js';

export class TokenDomain extends BaseDomain {
  constructor({ network } = {}) {
    super();
    this.network = network || null;
  }

  /**
   * 获取通证余额列表
   * @param {string} address - 地址
   * @returns {Promise<Array>} 通证列表
   */
  async getTokenBalances(address) {
    if (!address) {
      throw new Error('地址不能为空');
    }

    const result = await this._sendMessage(WalletMessageType.GET_TOKEN_BALANCES, {
      address
    });

    return result.tokens || [];
  }

  /**
   * 添加通证
   * @param {Object} tokenInfo - 代币信息
   * @returns {Promise<Object>} 添加结果
   */
  async addToken(tokenInfo) {
    const result = await this._sendMessage(WalletMessageType.ADD_TOKEN, {
      token: tokenInfo
    });
    return result.token;
  }

  /**
   * 获取原生代币信息
   * @param {string} address - 地址
   * @returns {Promise<Object|null>}
   */
  async getNativeToken(address) {
    if (!address) return null;

    let chainId = null;
    try {
      chainId = await this.network?.getChainId();
    } catch (error) {
      console.warn('[TokenDomain] 获取链 ID 失败:', error);
    }

    let symbol = 'ETH';
    let name = '原生代币';
    let balance = '0';

    if (chainId) {
      try {
        const info = await this.network?.getNetworkInfo();
        if (info) {
          symbol = info.nativeCurrency?.symbol || info.symbol || symbol;
          name = info.nativeCurrency?.name || info.name || info.chainName || name;
        }
      } catch (error) {
        console.warn('[TokenDomain] 获取网络信息失败:', error);
      }
    }

    try {
      const result = await this._sendMessage(WalletMessageType.GET_BALANCE, { address });
      if (result?.balance !== undefined && result?.balance !== null && result?.balance !== '') {
        balance = result.balance;
      }
    } catch (error) {
      console.warn('[TokenDomain] 获取原生代币余额失败:', error);
    }

    return {
      symbol,
      name,
      balance,
      isNative: true
    };
  }
}
