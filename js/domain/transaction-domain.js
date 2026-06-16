/**
 * 交易域 - 封装交易相关操作
 * 
 * 职责：
 * 1. 发送交易
 * 2. 交易签名
 * 3. 消息签名
 * 4. 交易记录管理
 * 
 * 通信协议：{ type, data }
 */
import { isValidAddress } from '../common/chain/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { TransactionMessageType } from '../protocol/extension-protocol.js';
import { BaseDomain } from './base-domain.js';
export { TransactionMessageType };

export class TransactionDomain extends BaseDomain {
  constructor() {
    super();
    this._transactions = [];
  }

  // ==================== 单位转换 ====================

  /**
   * ETH 转换为 Wei
   * @param {string|number} ether - ETH 数量
   * @returns {string} Wei 数量（十六进制）
   */
  parseEther(ether) {
    return this.parseUnits(ether, 18, 'ETH');
  }

  /**
   * 代币数量转换为最小单位
   * @param {string|number} amount - 数量
   * @param {number} decimals - 小数位
   * @param {string} label - 单位标签
   * @returns {string} 最小单位（十六进制）
   */
  parseUnits(amount, decimals = 18, label = 'token') {
    const raw = String(amount ?? '').trim();
    const parsedDecimals = Number(decimals);
    const decimalPlaces = Number.isInteger(parsedDecimals) && parsedDecimals >= 0 ? parsedDecimals : 18;
    if (!raw || decimalPlaces < 0) {
      throw new Error(`无效的 ${label} 数量`);
    }
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new Error(`无效的 ${label} 数量`);
    }

    const [integerPart, fractionPart = ''] = raw.split('.');
    if (fractionPart.length > decimalPlaces) {
      throw new Error(`${label} 最多支持 ${decimalPlaces} 位小数`);
    }

    const paddedFraction = fractionPart.padEnd(decimalPlaces, '0');
    const integerValue = BigInt(integerPart || '0') * (10n ** BigInt(decimalPlaces));
    const fractionValue = paddedFraction ? BigInt(paddedFraction) : 0n;
    const value = integerValue + fractionValue;
    if (value <= 0n) {
      throw new Error(`无效的 ${label} 数量`);
    }
    return `0x${value.toString(16)}`;
  }

  /**
   * Wei 转换为 ETH
   * @param {string} wei - Wei 数量（十六进制或十进制）
   * @returns {string} ETH 数量
   */
  formatEther(wei) {
    return this.formatUnits(wei, 18);
  }

  /**
   * 最小单位转换为代币数量
   * @param {string} value - 最小单位（十六进制或十进制）
   * @param {number} decimals - 小数位
   * @returns {string} 格式化数量
   */
  formatUnits(value, decimals = 18) {
    try {
      if (value === null || value === undefined || value === '') {
        return '0.000000';
      }
      const normalized = typeof value === 'string' ? value.trim() : value;
      const raw = BigInt(normalized);
      const decimalPlaces = Number.isInteger(Number(decimals)) && Number(decimals) >= 0 ? Number(decimals) : 18;
      const base = 10n ** BigInt(decimalPlaces);
      const integer = raw / base;
      const fraction = raw % base;
      if (decimalPlaces === 0) {
        return integer.toString();
      }
      const fractionText = fraction.toString().padStart(decimalPlaces, '0').slice(0, 6);
      const formatted = `${integer}.${fractionText}`.replace(/\.?0+$/, '');
      return formatted || '0';
    } catch (error) {
      return '0.000000';
    }
  }

  /**
   * Gwei 转换为 Wei
   * @param {string|number} gwei - Gwei 数量
   * @returns {string} Wei 数量（十六进制）
   */
  parseGwei(gwei) {
    const value = typeof gwei === 'string' ? parseFloat(gwei) : gwei;
    if (isNaN(value) || value < 0) {
      throw new Error('无效的 Gwei 数量');
    }
    const wei = BigInt(Math.floor(value * 1e9));
    return '0x' + wei.toString(16);
  }

  // ==================== 交易操作 ====================

  /**
   * 发送交易
   * @param {Object} txParams - 交易参数
   * @param {string} txParams.from - 发送地址
   * @param {string} txParams.to - 接收地址
   * @param {string} txParams.value - 发送金额（十六进制）
   * @param {string} txParams.data - 交易数据（可选）
   * @param {string} txParams.gas - Gas 限制（可选）
   * @param {string} txParams.chainId - 链 ID
   * @param {string} txParams.rpcUrl - RPC URL
   * @returns {Promise<string>} 交易哈希
   */
  async sendTransaction(txParams) {
    const { from, to, value, data, gas, chainId, rpcUrl, token } = txParams;

    // 参数验证
    if (!from || !isValidAddress(from)) {
      throw new Error('无效的发送地址');
    }

    if (!to || !isValidAddress(to)) {
      throw new Error('无效的接收地址');
    }

    if (!value) {
      throw new Error('请输入发送金额');
    }

    const result = await this._sendMessage(TransactionMessageType.SEND_TRANSACTION, {
      from,
      to,
      value,
      data: data || '0x',
      gas: gas || undefined,
      chainId,
      rpcUrl,
      token: token || null
    });

    // 添加到交易记录
    this._addTransaction({
      hash: result.txHash,
      from,
      to,
      value,
      token: token || null,
      timestamp: getTimestamp(),
      status: 'pending',
      chainId: chainId || null
    });

    return result.txHash;
  }

  /**
   * 签名交易
   * @param {Object} transaction - 交易对象
   * @param {string} password - 密码
   * @returns {Promise<string>} 签名后的交易
   */
  async signTransaction(transaction, password) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(TransactionMessageType.SIGN_TRANSACTION, {
      transaction,
      password
    });

    return result.signedTransaction;
  }

  /**
   * 签名消息
   * @param {string} message - 消息内容
   * @param {string} password - 密码
   * @returns {Promise<string>} 签名结果
   */
  async signMessage(message, password) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    if (!message) {
      throw new Error('消息内容不能为空');
    }

    const result = await this._sendMessage(TransactionMessageType.SIGN_MESSAGE, {
      message,
      password
    });

    return result.signature;
  }

  // ==================== Gas 估算 ====================

  /**
   * 估算 Gas 费用
   * @param {Object} txParams - 交易参数
   * @returns {Promise<string>} 估算的 Gas 数量
   */
  async estimateGas(txParams) {
    const result = await this._sendMessage(TransactionMessageType.ESTIMATE_GAS, txParams);
    return result.gas;
  }

  /**
   * 获取当前 Gas 价格
   * @param {Object} params - 网络参数
   * @returns {Promise<string>} 当前 Gas 价格（十六进制）
   */
  async getGasPrice(params = {}) {
    const result = await this._sendMessage(TransactionMessageType.GET_GAS_PRICE, params);
    return result.gasPrice;
  }

  // ==================== 交易记录 ====================

  /**
   * 获取交易记录
   * @param {string} address - 地址
   * @returns {Promise<Array>} 交易记录
   */
  async getTransactions(address, chainId = null) {
    try {
      const result = await this._sendMessage(TransactionMessageType.GET_TRANSACTIONS, {
        address,
        chainId
      });
      this._transactions = result.transactions || [];
      return this._transactions;
    } catch (error) {
      console.error('[TransactionDomain] 获取交易记录失败:', error);
      return this._transactions;
    }
  }

  /**
   * 清除交易记录
   * @returns {Promise<Object>} 清除结果
   */
  async clearTransactions(address = null, chainId = null) {
    const result = await this._sendMessage(TransactionMessageType.CLEAR_TRANSACTIONS, {
      address,
      chainId
    });
    this._transactions = [];
    return result;
  }

  /**
   * 添加交易到本地记录
   * @param {Object} tx - 交易对象
   */
  _addTransaction(tx) {
    this._transactions.unshift(tx);
    // 限制本地存储的数量
    if (this._transactions.length > 100) {
      this._transactions = this._transactions.slice(0, 100);
    }
  }

  /**
   * 更新交易状态
   * @param {string} txHash - 交易哈希
   * @param {string} status - 新状态
   */
  async updateTransactionStatus(txHash, status) {
    const tx = this._transactions.find(t => t.hash === txHash);
    if (tx) {
      tx.status = status;
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 格式化交易金额显示
   * @param {string} value - 金额（十六进制）
   * @param {boolean} isSent - 是否是发送交易
   * @returns {string} 格式化后的金额
   */
  formatTransactionValue(value, isSent = true) {
    const ether = this.formatEther(value);
    const prefix = isSent ? '-' : '+';
    return `${prefix}${ether} ETH`;
  }

  /**
   * 获取交易状态显示文本
   * @param {string} status - 状态
   * @returns {string} 显示文本
   */
  getStatusText(status) {
    const statusMap = {
      pending: '待确认',
      confirmed: '已确认',
      failed: '失败',
      cancelled: '已取消'
    };
    return statusMap[status] || status;
  }
}
