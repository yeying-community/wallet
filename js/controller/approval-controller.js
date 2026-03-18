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
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
import { shortenAddress } from '../common/chain/index.js'
import { formatLocaleDateTime } from '../common/utils/time-utils.js';

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
    this.followupTimer = null;
    this.hasQueuedFollowup = false;
    this.runtimeMessageListener = null;
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
      case 'unlock':
        this.bindUnlockEvents();
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

  bindUnlockEvents() {
    const approveBtn = document.getElementById('approveUnlock');
    const cancelBtn = document.getElementById('cancelUnlock');
    const passwordInput = document.getElementById('unlockPassword');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveUnlock());
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeWindow());
    }
    if (passwordInput) {
      passwordInput.addEventListener('keypress', async (event) => {
        if (event.key === 'Enter') {
          await this.approveUnlock();
        }
      });
      setTimeout(() => passwordInput.focus(), 0);
    }

    this.renderUnlockReason();
  }

  renderUnlockReason() {
    const info = this.requestData || {};
    const originEl = document.getElementById('unlockOrigin');
    const container = document.getElementById('unlockReason');
    const reasonOriginEl = document.getElementById('unlockReasonOrigin');
    const methodEl = document.getElementById('unlockReasonMethod');
    const timeEl = document.getElementById('unlockReasonTime');
    const badgeEl = document.getElementById('unlockReasonMethodBadge');

    if (originEl) {
      originEl.textContent = info.origin || '会话已过期，请输入密码继续';
    }
    if (!container) {
      return;
    }
    if (!info || (!info.origin && !info.method && !info.timestamp)) {
      container.classList.add('hidden');
      return;
    }

    const formatted = this.formatUnlockMethod(info.method);
    if (reasonOriginEl) {
      reasonOriginEl.textContent = info.origin || '-';
    }
    if (methodEl) {
      methodEl.textContent = formatted.detail || formatted.label || info.method || '-';
    }
    if (badgeEl) {
      badgeEl.textContent = formatted.label || '-';
    }
    if (timeEl) {
      timeEl.textContent = info.timestamp ? formatLocaleDateTime(info.timestamp) : '-';
    }
    container.classList.remove('hidden');
  }

  formatUnlockMethod(method) {
    const raw = String(method || '').trim();
    if (!raw) {
      return { label: '请求', detail: '-' };
    }
    const map = {
      yeying_ucan_sign: { label: 'UCAN', detail: 'UCAN 签名' },
      yeying_ucan_session: { label: 'UCAN', detail: 'UCAN 会话' },
      eth_requestAccounts: { label: '连接', detail: '连接钱包' },
      eth_sendTransaction: { label: '交易', detail: '发送交易' },
      eth_signTransaction: { label: '交易', detail: '签名交易' },
      personal_sign: { label: '签名', detail: '消息签名' },
      eth_sign: { label: '签名', detail: '消息签名' },
      eth_signTypedData: { label: '签名', detail: '结构化签名' },
      eth_signTypedData_v4: { label: '签名', detail: '结构化签名' },
      wallet_requestPermissions: { label: '授权', detail: '权限请求' },
      wallet_addEthereumChain: { label: '网络', detail: '添加网络' },
      wallet_switchEthereumChain: { label: '网络', detail: '切换网络' },
      wallet_watchAsset: { label: '资产', detail: '添加资产' }
    };
    if (map[raw]) {
      return map[raw];
    }
    const lower = raw.toLowerCase();
    if (lower.includes('siwe')) {
      return { label: 'SIWE', detail: 'SIWE 登录' };
    }
    if (lower.includes('ucan')) {
      return { label: 'UCAN', detail: 'UCAN 请求' };
    }
    return { label: '请求', detail: raw };
  }

  async approveUnlock() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const passwordInput = document.getElementById('unlockPassword');
    const password = passwordInput?.value || '';

    if (!password) {
      this.isProcessing = false;
      showError('请输入密码');
      return;
    }

    try {
      showWaiting();
      const currentAccount = await this.wallet.getCurrentAccount();
      await this.wallet.unlock(password, currentAccount?.id);
      showSuccess('解锁成功');
      this.enterTransitionState({
        closeAfterMs: 1500
      });
    } catch (error) {
      this.isProcessing = false;
      showError('密码错误');
    }
  }

  bindConnectEvents() {
    const approveBtn = document.getElementById('approveConnect');
    const rejectBtn = document.getElementById('rejectConnect');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => this.approveConnect());
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.reject());
    }

    this.bindApprovalQueueEvents();
  }

  async approveConnect() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.isProcessing = false;
        showError('请先创建或导入钱包');
        return;
      }

      // 发送授权响应
      await this.sendResponse({
        approved: true,
        account: account
      });

      showSuccess('已授权连接');
      this.enterTransitionState({
        closeAfterMs: this.hasQueuedFollowup ? 1500 : 300
      });
    } catch (error) {
      this.isProcessing = false;
      showError('授权失败: ' + error.message);
    }
  }

  bindApprovalQueueEvents() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return;
    }

    const hintEl = document.getElementById('connectFlowHint');
    if (!hintEl) {
      return;
    }

    this.runtimeMessageListener = (message) => {
      if (message?.type !== ApprovalMessageType.APPROVAL_QUEUE_UPDATE) {
        return;
      }
      if (message?.data?.activeRequestId !== this.requestId) {
        return;
      }

      this.hasQueuedFollowup = true;
      const queueSize = Number.isFinite(message?.data?.queueSize)
        ? message.data.queueSize
        : 1;
      hintEl.textContent = queueSize > 1
        ? `检测到 ${queueSize} 个后续请求，连接后会继续确认签名。`
        : '检测到后续签名请求，连接后会继续签名确认。';
      hintEl.classList.remove('hidden');
    };

    chrome.runtime.onMessage.addListener(this.runtimeMessageListener);
  }

  // ==================== 交易签名请求 ====================

  bindTransactionEvents() {
    const approveBtn = document.getElementById('approveTx');
    const rejectBtn = document.getElementById('rejectTx');

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
    const txPayload = this.requestData?.transaction || this.requestData || {};
    
    // 更新 UI 显示
    const siteOrigin = document.getElementById('txOrigin');
    if (siteOrigin) {
      siteOrigin.textContent = this.requestData?.origin || txPayload.origin || '未知网站';
    }

    const txTo = document.getElementById('txTo');
    if (txTo) {
      txTo.textContent = txPayload?.to ? shortenAddress(txPayload.to) : '合约创建';
    }

    const txValue = document.getElementById('txValue');
    if (txValue) {
      let value = 0;
      if (txPayload?.value) {
        const raw = txPayload.value;
        if (typeof raw === 'string' && raw.startsWith('0x')) {
          value = parseInt(raw, 16) / 1e18;
        } else {
          value = Number(raw) / 1e18;
        }
      }
      txValue.textContent = `${Number.isFinite(value) ? value.toFixed(6) : '0.000000'} ETH`;
    }

    const txGasLimit = document.getElementById('txGasLimit');
    if (txGasLimit) {
      const gasLimit = txPayload?.gasLimit || txPayload?.gas;
      txGasLimit.textContent = gasLimit
        ? parseInt(gasLimit, 16).toLocaleString()
        : '自动';
    }

    const txGasPrice = document.getElementById('txGasPrice');
    if (txGasPrice) {
      let gasPriceGwei = null;
      if (txPayload?.gasPrice) {
        const raw = txPayload.gasPrice;
        const wei = typeof raw === 'string' && raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw);
        gasPriceGwei = Number.isFinite(wei) ? (wei / 1e9) : null;
      }
      txGasPrice.textContent = gasPriceGwei !== null
        ? `${gasPriceGwei.toFixed(2)} Gwei`
        : '自动';
    }

    // 显示原始数据（可选）
    const txDataRow = document.getElementById('txDataRow');
    const txData = document.getElementById('txData');
    if (txDataRow && txData) {
      if (txPayload?.data && txPayload.data !== '0x') {
        txDataRow.style.display = 'flex';
        txData.textContent = txPayload.data.slice(0, 100) + (txPayload.data.length > 100 ? '...' : '');
      } else {
        txDataRow.style.display = 'none';
      }
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
    if (messageEl && this.requestData.message && !messageEl.dataset.rendered) {
      messageEl.textContent = this.requestData.message;
    }

    const siteOrigin = document.getElementById('signOrigin');
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
    const tokenInfo = this.requestData.tokenInfo || this.requestData.asset || {};
    
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

  enterTransitionState(options = {}) {
    this.clearFollowupTimer();

    const closeAfterMs = Number.isFinite(options.closeAfterMs) ? options.closeAfterMs : 800;
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    document.querySelectorAll('input').forEach((input) => {
      input.disabled = true;
    });

    if (closeAfterMs > 0) {
      this.followupTimer = setTimeout(() => {
        this.closeWindow();
      }, closeAfterMs);
    }
  }

  showFollowupWaitingState(options = {}) {
    this.clearFollowupTimer();

    const title = options.title || '等待后续请求';
    const description = options.description || '当前授权已完成';
    const hint = options.hint || '';
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;

    document.querySelectorAll('.request-view').forEach((view) => {
      view.classList.add('hidden');
    });

    const waitingView = document.getElementById('approvalWaiting');
    const titleEl = document.getElementById('waitingTitle');
    const descriptionEl = document.getElementById('waitingDescription');
    const hintEl = document.getElementById('waitingHint');
    const closeBtn = document.getElementById('waitingCloseButton');

    if (titleEl) {
      titleEl.textContent = title;
    }
    if (descriptionEl) {
      descriptionEl.textContent = description;
    }
    if (hintEl) {
      hintEl.textContent = hint;
    }
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.addEventListener('click', () => this.closeWindow());
      closeBtn.dataset.bound = 'true';
    }
    if (waitingView) {
      waitingView.classList.remove('hidden');
    }

    if (timeoutMs > 0) {
      this.followupTimer = setTimeout(() => {
        this.closeWindow();
      }, timeoutMs);
    }
  }

  clearFollowupTimer() {
    if (!this.followupTimer) return;
    clearTimeout(this.followupTimer);
    this.followupTimer = null;
  }

  clearRuntimeListeners() {
    if (!this.runtimeMessageListener) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.runtimeMessageListener);
    }
    this.runtimeMessageListener = null;
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
    this.clearFollowupTimer();
    this.clearRuntimeListeners();
    if (typeof window !== 'undefined') {
      window.close();
    }
  }
}
