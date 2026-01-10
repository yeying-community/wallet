import { shortenAddress, formatTxHash, normalizeChainId } from '../../common/chain/index.js';
import {
  showError,
  showSuccess,
  showPage,
  copyTxHashToClipboard,
  copyAddressToClipboard,
  createCopyToastHandler
} from '../../common/ui/index.js';
import { formatLocaleDateTime, getTimestamp } from '../../common/utils/time-utils.js';

export class TransactionDetailController {
  constructor({ transaction, network } = {}) {
    this.transaction = transaction;
    this.network = network;
    this.currentTx = null;
    this.detailActionsBound = false;
  }

  bindEvents() {
    this.bindDetailActions();
  }

  async openTransactionDetail(tx) {
    if (!tx) {
      showError('交易信息不存在');
      return;
    }

    this.currentTx = tx;
    this.bindDetailActions();

    const status = tx?.status || 'pending';
    const statusText = this.transaction?.getStatusText?.(status) || status;
    const statusEl = document.getElementById('txDetailStatus');
    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.className = `detail-value tx-status ${status}`;
    }

    this.setDetailValueWithTitle('txDetailHash', formatTxHash(tx?.hash || ''), tx?.hash || '');
    this.setDetailValueWithTitle('txDetailFrom', shortenAddress(tx?.from || ''), tx?.from || '');
    this.setDetailValueWithTitle('txDetailTo', shortenAddress(tx?.to || ''), tx?.to || '');

    const networkMeta = await this.getNetworkMeta(tx?.chainId);
    const symbol = networkMeta?.symbol || await this.getCurrentNetworkSymbol();
    const amount = this.transaction?.formatEther?.(tx?.value || '0') || '0';
    this.setDetailValue('txDetailValue', `${amount} ${symbol}`);

    const timeValue = tx?.timestamp ? tx.timestamp : getTimestamp();
    this.setDetailValue('txDetailTime', formatLocaleDateTime(timeValue));

    this.setDetailValue('txDetailNetwork', networkMeta?.name || '网络');

    if (tx?.confirmedAt) {
      this.toggleDetailRow('txDetailConfirmedRow', true);
      this.setDetailValue('txDetailConfirmedTime', formatLocaleDateTime(tx.confirmedAt));
    } else {
      this.toggleDetailRow('txDetailConfirmedRow', false);
    }

    if (tx?.blockNumber !== undefined && tx?.blockNumber !== null) {
      this.toggleDetailRow('txDetailBlockRow', true);
      this.setDetailValue('txDetailBlock', String(tx.blockNumber));
    } else {
      this.toggleDetailRow('txDetailBlockRow', false);
    }

    if (tx?.chainId) {
      this.toggleDetailRow('txDetailChainRow', true);
      this.setDetailValue('txDetailChain', String(tx.chainId));
    } else {
      this.toggleDetailRow('txDetailChainRow', false);
    }

    const explorerUrl = this.buildExplorerTxUrl(networkMeta?.explorer, tx?.hash);
    const explorerRow = document.getElementById('txDetailExplorerRow');
    const explorerLink = document.getElementById('txDetailExplorerLink');
    if (explorerRow && explorerLink && explorerUrl) {
      explorerLink.href = explorerUrl;
      explorerRow.classList.remove('hidden');
    } else if (explorerRow) {
      explorerRow.classList.add('hidden');
    }

    showPage('transactionDetailPage');
  }

  setDetailValue(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value || '-';
    }
  }

  setDetailValueWithTitle(id, value, title) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || '-';
    el.title = title || '';
  }

  toggleDetailRow(id, show) {
    const row = document.getElementById(id);
    if (!row) return;
    row.classList.toggle('hidden', !show);
  }

  bindDetailActions() {
    if (this.detailActionsBound) return;
    const copyToast = createCopyToastHandler({
      onSuccess: showSuccess,
      onError: showError
    });

    const copyHashBtn = document.getElementById('txDetailCopyHash');
    if (copyHashBtn) {
      copyHashBtn.addEventListener('click', () => {
        const hash = this.currentTx?.hash;
        if (!hash) return;
        copyTxHashToClipboard(hash, copyToast);
      });
    }

    const copyFromBtn = document.getElementById('txDetailCopyFrom');
    if (copyFromBtn) {
      copyFromBtn.addEventListener('click', () => {
        const address = this.currentTx?.from;
        if (!address) return;
        copyAddressToClipboard(address, copyToast);
      });
    }

    const copyToBtn = document.getElementById('txDetailCopyTo');
    if (copyToBtn) {
      copyToBtn.addEventListener('click', () => {
        const address = this.currentTx?.to;
        if (!address) return;
        copyAddressToClipboard(address, copyToast);
      });
    }

    this.detailActionsBound = true;
  }

  async getCurrentNetworkSymbol() {
    try {
      const info = await this.network?.getNetworkInfo?.();
      return info?.nativeCurrency?.symbol || info?.symbol || 'ETH';
    } catch (error) {
      return 'ETH';
    }
  }

  async getNetworkMeta(chainId) {
    if (!this.network) {
      return { name: '网络', symbol: 'ETH', explorer: '' };
    }

    let normalized = null;
    if (chainId) {
      try {
        normalized = normalizeChainId(chainId);
      } catch {
        normalized = String(chainId);
      }
    }

    let matched = null;
    try {
      const networks = await this.network.getNetworks();
      if (Array.isArray(networks) && normalized) {
        matched = networks.find(item => {
          const id = item?.chainIdHex || item?.chainId;
          if (!id) return false;
          try {
            return normalizeChainId(id) === normalized;
          } catch {
            return String(id) === normalized;
          }
        });
      }
    } catch (error) {
      matched = null;
    }

    if (!matched) {
      try {
        matched = await this.network.getNetworkInfo();
      } catch (error) {
        matched = null;
      }
    }

    const name = matched?.chainName || matched?.name || matched?.nativeCurrency?.name || matched?.symbol || '网络';
    const symbol = matched?.nativeCurrency?.symbol || matched?.symbol || 'ETH';
    const explorer = matched?.explorer || matched?.blockExplorerUrls?.[0] || '';
    return { name, symbol, explorer };
  }

  buildExplorerTxUrl(baseUrl, txHash) {
    if (!baseUrl || !txHash) return '';
    const trimmed = String(baseUrl).replace(/\/+$/, '');
    return `${trimmed}/tx/${txHash}`;
  }
}
