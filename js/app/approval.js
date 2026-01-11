/**
 * 授权页面入口
 */

import { ApprovalController } from '../controller/approval-controller.js';
import { WalletDomain } from '../domain/wallet-domain.js';
import { TransactionDomain } from '../domain/transaction-domain.js';
import { NetworkDomain } from '../domain/network-domain.js';
import { TokenDomain } from '../domain/token-domain.js';
import { ethers } from '../../lib/ethers-5.7.esm.min.js';
import { showToast } from '../common/ui/index.js';
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
class ApprovalApp {
  constructor() {
    this.wallet = new WalletDomain();
    this.transaction = new TransactionDomain();
    this.network = new NetworkDomain();
    this.token = new TokenDomain({ network: this.network });
    this.controller = null;
    this.requestId = null;
    this.requestType = null;
    this.requestData = null;
  }

  async init() {
    try {
      // 解析URL参数
      const urlParams = new URLSearchParams(window.location.search);
      this.requestId = urlParams.get('requestId');
      this.requestType = this.normalizeRequestType(urlParams.get('type'));

      if (!this.requestId || !this.requestType) {
        showToast('无效的请求参数', 'error');
        setTimeout(() => window.close(), 2000);
        return;
      }

      // 从background获取请求详情
      const response = await chrome.runtime.sendMessage({
        type: ApprovalMessageType.GET_PENDING_REQUEST,
        data: { requestId: this.requestId }
      });

      if (!response || !response.request) {
        showToast('无法获取请求详情', 'error');
        setTimeout(() => window.close(), 2000);
        return;
      }

      this.requestData = response.request?.data || response.request;

      // 根据类型显示对应界面
      this.renderRequestUI();

      // 初始化控制器
      this.controller = new ApprovalController({
        wallet: this.wallet,
        transaction: this.transaction,
        network: this.network,
        token: this.token,
        requestId: this.requestId,
        requestType: this.requestType,
        requestData: this.requestData
      });
      
      this.controller.bindEvents();
      
    } catch (error) {
      console.error('初始化失败:', error);
      showToast('初始化失败: ' + error.message, 'error');
      setTimeout(() => window.close(), 2000);
    }
  }

  normalizeRequestType(type) {
    if (!type) return type;
    if (type === 'sign_message' || type === 'sign_typed_data') {
      return 'sign';
    }
    if (type === 'sign_transaction') {
      return 'transaction';
    }
    return type;
  }

  renderRequestUI() {
    switch (this.requestType) {
      case 'connect':
        this.renderConnectRequest();
        break;
      case 'transaction':
        this.renderTransactionRequest();
        break;
      case 'sign':
        this.renderSignRequest();
        break;
      case 'addChain':
        this.renderAddChainRequest();
        break;
      case 'watchAsset':
        this.renderWatchAssetRequest();
        break;
      default:
        showToast('未知的请求类型: ' + this.requestType, 'error');
        setTimeout(() => window.close(), 2000);
    }
  }

  renderConnectRequest() {
    document.getElementById('connectRequest').classList.remove('hidden');
    document.getElementById('connectOrigin').textContent = this.requestData.origin;
  }

  renderTransactionRequest() {
    document.getElementById('transactionRequest').classList.remove('hidden');
    document.getElementById('txOrigin').textContent = this.requestData.origin;

    const tx = this.requestData.transaction;
    document.getElementById('txTo').textContent = tx.to || '合约创建';
    document.getElementById('txValue').textContent =
      ethers.utils.formatEther(tx.value || '0') + ' ETH';
    document.getElementById('txGasLimit').textContent = tx.gasLimit || '自动';
    document.getElementById('txGasPrice').textContent =
      tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, 'gwei') + ' Gwei' : '自动';

    if (tx.data && tx.data !== '0x') {
      document.getElementById('txDataRow').style.display = 'flex';
      document.getElementById('txData').textContent =
        tx.data.substring(0, 20) + '...';
    }
  }

  renderSignRequest() {
    document.getElementById('signRequest').classList.remove('hidden');
    document.getElementById('signOrigin').textContent = this.requestData.origin;

    let message = this.requestData.message;

    // 处理TypedData签名
    if (this.requestData.typedData) {
      try {
        message = JSON.stringify(this.requestData.typedData, null, 2);
      } catch (e) {
        message = String(this.requestData.typedData);
      }
    }
    // 处理普通签名
    else if (message && message.startsWith('0x')) {
      try {
        message = ethers.utils.toUtf8String(message);
      } catch (e) {
        // 保持原样
      }
    }

    document.getElementById('signMessage').textContent = message;
  }

  renderAddChainRequest() {
    document.getElementById('addChainRequest').classList.remove('hidden');
    document.getElementById('addChainOrigin').textContent = this.requestData.origin;

    const chain = this.requestData.chainConfig;

    document.getElementById('chainName').textContent = chain.chainName || '未知';
    document.getElementById('chainId').textContent = chain.chainId || '未知';
    document.getElementById('chainRpcUrl').textContent =
      Array.isArray(chain.rpcUrls) ? chain.rpcUrls[0] : chain.rpcUrls || '未知';

    // 可选字段
    if (chain.nativeCurrency?.symbol) {
      document.getElementById('chainSymbol').textContent = chain.nativeCurrency.symbol;
      document.getElementById('chainSymbolRow').style.display = 'flex';
    }

    if (chain.blockExplorerUrls && chain.blockExplorerUrls[0]) {
      document.getElementById('chainExplorer').textContent = chain.blockExplorerUrls[0];
      document.getElementById('chainExplorerRow').style.display = 'flex';
    }
  }

  renderWatchAssetRequest() {
    document.getElementById('watchAssetRequest').classList.remove('hidden');
    document.getElementById('watchAssetOrigin').textContent = this.requestData.origin;

    const asset = this.requestData.asset;

    document.getElementById('assetSymbol').textContent = asset.symbol || '未知';
    document.getElementById('assetAddress').textContent = asset.address || '未知';
    document.getElementById('assetDecimals').textContent = asset.decimals || '18';

    // 显示代币图标
    if (asset.image) {
      const img = document.getElementById('assetImage');
      img.src = asset.image;
      img.style.display = 'block';
      document.getElementById('assetIconPlaceholder').style.display = 'none';

      // 图片加载失败时显示占位符
      img.onerror = () => {
        img.style.display = 'none';
        document.getElementById('assetIconPlaceholder').style.display = 'flex';
      };
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new ApprovalApp();
  app.init();
});
