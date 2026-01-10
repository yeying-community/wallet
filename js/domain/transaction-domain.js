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
    const value = typeof ether === 'string' ? parseFloat(ether) : ether;
    if (isNaN(value) || value < 0) {
      throw new Error('无效的 ETH 数量');
    }
    // 转换为 Wei
    const wei = BigInt(Math.floor(value * 1e18));
    return '0x' + wei.toString(16);
  }

  /**
   * Wei 转换为 ETH
   * @param {string} wei - Wei 数量（十六进制或十进制）
   * @returns {string} ETH 数量
   */
  formatEther(wei) {
    try {
      if (wei === null || wei === undefined || wei === '') {
        return '0.000000';
      }
      const normalized = typeof wei === 'string' ? wei.trim() : wei;
      const weiBigInt = BigInt(normalized);
      const ether = Number(weiBigInt) / 1e18;
      return ether.toFixed(6);
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
    const { from, to, value, data, gas, chainId, rpcUrl } = txParams;

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
      rpcUrl
    });

    // 添加到交易记录
    this._addTransaction({
      hash: result.txHash,
      from,
      to,
      value,
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
   * @returns {Promise<string>} 当前 Gas 价格（十六进制）
   */
  async getGasPrice() {
    const result = await this._sendMessage(TransactionMessageType.GET_GAS_PRICE);
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
