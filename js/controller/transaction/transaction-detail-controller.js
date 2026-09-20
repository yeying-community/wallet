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
    const displayTo = tx?.token?.recipient || tx?.to || '';
    this.setDetailValueWithTitle('txDetailTo', shortenAddress(displayTo), displayTo);

    const networkMeta = await this.getNetworkMeta(tx?.chainId);
    const symbol = networkMeta?.symbol || await this.getCurrentNetworkSymbol();
    const amountInfo = this.formatTransactionAmount(tx, symbol);
    this.setDetailValue('txDetailValue', amountInfo);

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

    const explorerUrl = this.buildExplorerTxUrl(networkMeta, tx?.hash);
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

  formatTransactionAmount(tx, nativeSymbol) {
    const token = tx?.token || null;
    if (token?.amount) {
      const decimals = Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : 18;
      const amount = this.transaction?.formatUnits?.(token.amount, decimals) || '0';
      return `${amount} ${token.symbol || 'TOKEN'}`;
    }
    // 非 EVM 链 value 已是格式化展示串（"0.1 SOL"），直接透传；
    // 仅 hex/十进制原始单位才按 18 位 wei→ETH。
    const rawValue = tx?.value;
    const isRawUnits = typeof rawValue === 'string'
      ? (/^0x[0-9a-fA-F]+$/.test(rawValue.trim()) || /^[0-9]+$/.test(rawValue.trim()))
      : (typeof rawValue === 'bigint' || typeof rawValue === 'number');
    if (!isRawUnits && rawValue) {
      return String(rawValue).trim();
    }
    const amount = this.transaction?.formatEther?.(rawValue || '0') || '0';
    return `${amount} ${nativeSymbol}`;
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
    const namespace = matched?.namespace || '';
    const reference = matched?.reference || '';
    return { name, symbol, explorer, namespace, reference };
  }

  buildExplorerTxUrl(meta, txHash) {
    // 向后兼容：旧调用传 baseUrl 字符串；新调用传 networkMeta 对象。
    const explorer = typeof meta === 'string' ? meta : (meta?.explorer || '');
    const namespace = typeof meta === 'string' ? '' : (meta?.namespace || '');
    const reference = typeof meta === 'string' ? '' : (meta?.reference || '');
    if (!explorer || !txHash) return '';
    const base = String(explorer).replace(/\/+$/, '');
    if (namespace === 'tron') {
      return `${base}/#/transaction/${txHash}`;
    }
    if (namespace === 'solana') {
      const cluster = reference && reference !== 'mainnet-beta' ? `?cluster=${reference}` : '';
      return `${base}/tx/${txHash}${cluster}`;
    }
    return `${base}/tx/${txHash}`;
  }
}
