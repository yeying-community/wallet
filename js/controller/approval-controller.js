/**
 * 授权页面控制器
 * 
 * 职责：
 * 1. 处理 DApp 发起的各种授权请求
 * 2. 显示请求详情并获取用户确认
 * 3. 将用户决策发送回 background 处理
 * 
 * 支持的请求类型：
 * - connect: 网站连接请求
 * - transaction: 交易签名请求
 * - sign: 消息签名请求
 * - addChain: 添加自定义网络请求
 * - watchAsset: 添加代币请求
 */

import { showError, showSuccess, showWaiting } from '../common/ui/index.js';
import { ApprovalMessageType } from '../protocol/protocol.js';
import { shortenAddress } from '../common/chain/index.js'

export class ApprovalController {
  constructor(dependencies) {
    this.wallet = dependencies.wallet;
    this.transaction = dependencies.transaction;
    this.network = dependencies.network;
    this.token = dependencies.token;

    this.requestId = dependencies.requestId;
    this.requestType = dependencies.requestType;
    this.requestData = dependencies.requestData;

    this.isProcessing = false;
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    console.log(`[ApprovalController] 绑定事件: ${this.requestType}`);
    
    switch (this.requestType) {
      case 'connect':
        this.bindConnectEvents();
        break;
      case 'transaction':
        this.bindTransactionEvents();
        break;
      case 'sign':
        this.bindSignEvents();
        break;
      case 'addChain':
        this.bindAddChainEvents();
        break;
      case 'watchAsset':
        this.bindWatchAssetEvents();
        break;
      default:
        console.error(`[ApprovalController] 未知的请求类型: ${this.requestType}`);
        showError(`不支持的请求类型: ${this.requestType}`);
    }
  }

  // ==================== 连接请求 ====================

  bindConnectEvents() {
    const approveBtn = document.getElementById('approveConnect');
    const rejectBtn = document.getElementById('rejectConnect');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveConnect());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }
  }

  async approveConnect() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        showError('请先创建或导入钱包');
        return;
      }

      // 发送授权响应
      await this.sendResponse({
        approved: true,
        account: account
      });

      showSuccess('已授权连接');
      this.closeWindow();
    } catch (error) {
      this.isProcessing = false;
      showError('授权失败: ' + error.message);
    }
  }

  // ==================== 交易签名请求 ====================

  bindTransactionEvents() {
    const approveBtn = document.getElementById('approveTransaction');
    const rejectBtn = document.getElementById('rejectTransaction');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveTransaction());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }

    // 加载交易详情
    this.loadTransactionDetails();
  }

  loadTransactionDetails() {
    // 显示交易详情
    const txData = this.requestData;
    
    // 更新 UI 显示
    const siteOrigin = document.getElementById('txSiteOrigin');
    if (siteOrigin) {
      siteOrigin.textContent = txData.origin || '未知网站';
    }

    const txFrom = document.getElementById('txFrom');
    if (txFrom) {
      txFrom.textContent = shortenAddress(txData.from);
    }

    const txTo = document.getElementById('txTo');
    if (txTo) {
      txTo.textContent = shortenAddress(txData.to);
    }

    const txValue = document.getElementById('txValue');
    if (txValue) {
      const value = txData.value ? parseInt(txData.value, 16) / 1e18 : 0;
      txValue.textContent = `${value.toFixed(6)} ETH`;
    }

    const txGas = document.getElementById('txGas');
    if (txGas) {
      txGas.textContent = txData.gas ? parseInt(txData.gas, 16).toLocaleString() : '-';
    }

    // 显示原始数据（可选）
    const txRawData = document.getElementById('txRawData');
    if (txRawData) {
      txRawData.textContent = txData.data && txData.data !== '0x' 
        ? txData.data.slice(0, 100) + (txData.data.length > 100 ? '...' : '')
        : '无';
    }
  }

  async approveTransaction() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.sendResponse({ approved: true });
      this.closeWindow();
    } catch (error) {
      this.isProcessing = false;
      showError('签名失败: ' + error.message);
    }
  }

  // ==================== 消息签名请求 ====================

  bindSignEvents() {
    const approveBtn = document.getElementById('approveSign');
    const rejectBtn = document.getElementById('rejectSign');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveSign());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }

    // 显示签名消息
    const messageEl = document.getElementById('signMessage');
    if (messageEl && this.requestData.message) {
      messageEl.textContent = this.requestData.message;
    }

    const siteOrigin = document.getElementById('signSiteOrigin');
    if (siteOrigin) {
      siteOrigin.textContent = this.requestData.origin || '未知网站';
    }
  }

  async approveSign() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.sendResponse({ approved: true });
      this.closeWindow();
    } catch (error) {
      this.isProcessing = false;
      showError('签名失败: ' + error.message);
    }
  }

  // ==================== 添加自定义网络请求 ====================

  bindAddChainEvents() {
    const approveBtn = document.getElementById('approveAddChain');
    const rejectBtn = document.getElementById('rejectAddChain');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveAddChain());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }

    // 显示网络详情
    const chainInfo = this.requestData.chainInfo;
    
    const chainName = document.getElementById('chainName');
    if (chainName) {
      chainName.textContent = chainInfo?.chainName || '未知网络';
    }

    const chainId = document.getElementById('chainId');
    if (chainId) {
      chainId.textContent = chainInfo?.chainId || '-';
    }

    const rpcUrl = document.getElementById('chainRpcUrl');
    if (rpcUrl) {
      rpcUrl.textContent = chainInfo?.rpcUrls?.[0] || '-';
    }

    const explorer = document.getElementById('chainExplorer');
    if (explorer) {
      explorer.textContent = chainInfo?.blockExplorerUrls?.[0] || '-';
    }

    const symbol = document.getElementById('chainSymbol');
    if (symbol) {
      symbol.textContent = chainInfo?.nativeCurrency?.symbol || '-';
    }
  }

  async approveAddChain() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      showWaiting();

      // 添加网络
      await this.network.addNetwork(this.requestData.chainInfo);

      showSuccess('网络添加成功！');

      await this.sendResponse({
        approved: true
      });

      setTimeout(() => this.closeWindow(), 1000);
    } catch (error) {
      this.isProcessing = false;
      showError(`添加失败: ${error.message}`);
    }
  }

  // ==================== 添加代币请求 ====================

  bindWatchAssetEvents() {
    const approveBtn = document.getElementById('approveWatchAsset');
    const rejectBtn = document.getElementById('rejectWatchAsset');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveWatchAsset());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }

    // 显示代币详情
    const tokenInfo = this.requestData.tokenInfo;
    
    const tokenName = document.getElementById('tokenName');
    if (tokenName) {
      tokenName.textContent = tokenInfo?.name || '-';
    }

    const tokenSymbol = document.getElementById('tokenSymbol');
    if (tokenSymbol) {
      tokenSymbol.textContent = tokenInfo?.symbol || '-';
    }

    const tokenDecimals = document.getElementById('tokenDecimals');
    if (tokenDecimals) {
      tokenDecimals.textContent = tokenInfo?.decimals ?? '-';
    }

    const tokenAddress = document.getElementById('tokenAddress');
    if (tokenAddress) {
      tokenAddress.textContent = shortenAddress(tokenInfo?.address);
    }
  }

  async approveWatchAsset() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      showWaiting();

      // 添加代币到资产列表
      if (!this.token) {
        throw new Error('Token domain unavailable');
      }
      await this.token.addToken(this.requestData.tokenInfo);

      showSuccess('代币添加成功！');

      await this.sendResponse({
        approved: true
      });

      setTimeout(() => this.closeWindow(), 1000);
    } catch (error) {
      this.isProcessing = false;
      showError(`添加失败: ${error.message}`);
    }
  }

  // ==================== 通用方法 ====================

  /**
   * 拒绝请求
   */
  async reject() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.sendResponse({
        approved: false,
        error: '用户拒绝'
      });

      this.closeWindow();
    } catch (error) {
      console.error('[ApprovalController] 拒绝失败:', error);
      this.closeWindow();
    }
  }

  /**
   * 发送响应到 background
   */
  async sendResponse(response) {
    // 发送消息到 background
    if (typeof browser !== 'undefined') {
      await browser.runtime.sendMessage({
        type: ApprovalMessageType.APPROVAL_RESPONSE,
        requestId: this.requestId,
        ...response
      });
    } else if (typeof chrome !== 'undefined') {
      await chrome.runtime.sendMessage({
        type: ApprovalMessageType.APPROVAL_RESPONSE,
        requestId: this.requestId,
        ...response
      });
    }
  }

  /**
   * 关闭当前窗口
   */
  closeWindow() {
    if (typeof window !== 'undefined') {
      window.close();
    }
  }
}
