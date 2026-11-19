/**
 * 通证域 - 封装通证相关操作
 *
 * 职责：
 * 1. 获取通证余额列表
 * 2. 添加通证
 *
 * 通信协议：{ type, data }
 */

import { WalletMessageType } from '../protocol/extension-protocol.js';
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

    let symbol = '';
    let name = '原生代币';
    let balance = '0';
    let image = '';
    let chainKey = '';

    // 非 EVM 网络(波场 / 索拉纳 / 比特币)没有数字 chainId,也要按网络配置取原生币;
    // 以前只在有 chainId 时才读网络信息,这些网络就一直显示默认的「ETH / 原生代币」。
    try {
      const info = await this.network?.getNetworkInfo();
      if (info) {
        chainKey = String(info.chainKey || '');
        symbol = info.nativeCurrency?.symbol || info.symbol || symbol;
        name = info.nativeCurrency?.name || info.chainName || info.name || name;
        image = info.nativeCurrency?.icon || info.icon || image;
      }
    } catch (error) {
      console.warn('[TokenDomain] 获取网络信息失败:', error);
    }
    if (!symbol) symbol = chainId ? 'ETH' : '';

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
      image: image || this.getNativeTokenIcon(chainKey || chainId),
      isNative: true
    };
  }

  getNativeTokenIcon(chainKey) {
    const v = String(chainKey || '').toLowerCase();
    if (v.startsWith('tron:')) return '';
    if (v.startsWith('solana:')) return '';
    if (v.startsWith('bip122:')) return '';
    if (v === '0x1' || v === '1' || v === '0xaa36a7' || v === '11155111' || v === 'eip155:1' || v === 'eip155:11155111') {
      return 'assets/token-icons/source-official/ethereum.svg';
    }
    return '';
  }
}
