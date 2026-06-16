import { isValidAddress } from '../../common/chain/index.js';
import { showError, showWaiting, hideToast, hideWaiting } from '../../common/ui/index.js';
import { isWalletLockedError } from '../../common/errors/index.js';

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';

export class TransactionSendController {
  constructor({ wallet, transaction, network, balanceController, transactionListController } = {}) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
    this.balanceController = balanceController || null;
    this.transactionListController = transactionListController || null;
  }

  setBalanceController(controller) {
    this.balanceController = controller;
  }

  setTransactionListController(controller) {
    this.transactionListController = controller;
  }

  async handleSendTransaction({ requestPassword, onSuccess, silentBalanceRefresh = false, token = null } = {}) {
    const recipientInput = document.getElementById('recipientAddress');
    const amountInput = document.getElementById('amount');

    const recipient = recipientInput?.value.trim();
    const amount = amountInput?.value;

    if (!recipient) {
      showError('请输入接收地址');
      return;
    }

    if (!isValidAddress(recipient)) {
      showError('地址格式无效');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showError('请输入有效金额');
      return;
    }

    const sendTransaction = async () => {
      showWaiting();

      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        throw new Error('未找到账户');
      }

      const chainId = await this.network.getChainId();
      const rpcUrl = await this.network.getRpcUrl();
      const txParams = this.buildTransactionParams({
        from: account.address,
        recipient,
        amount,
        chainId,
        rpcUrl,
        token
      });

      const txHash = await this.transaction.sendTransaction(txParams);

      recipientInput.value = '';
      amountInput.value = '';

      if (silentBalanceRefresh) {
        await this.balanceController?.refreshBalanceSilently?.();
      } else {
        await this.balanceController?.refreshBalance?.();
      }

      await this.transactionListController?.loadTransactions?.();

      if (onSuccess) {
        await onSuccess(txHash);
      }

      hideWaiting();
      return txHash;
    };

    try {
      await sendTransaction();
    } catch (error) {
      console.error('[TransactionSendController] 发送交易失败:', error);
      if (isWalletLockedError(error) && requestPassword) {
        hideToast();
        hideWaiting();
        const password = await requestPassword();
        if (!password) {
          return;
        }
        try {
          showWaiting();
          const account = await this.wallet.getCurrentAccount();
          await this.wallet.unlock(password, account?.id, { source: 'popup' });
        } catch (unlockError) {
          console.error('[TransactionSendController] 解锁失败:', unlockError);
          showError('密码错误');
          return;
        }
        try {
          await sendTransaction();
        } catch (retryError) {
          console.error('[TransactionSendController] 重试发送失败:', retryError);
          showError(this.formatTransactionError(retryError));
        }
        return;
      }
      showError(this.formatTransactionError(error));
    }
  }

  buildTransactionParams({ from, recipient, amount, chainId, rpcUrl, token }) {
    if (!token || token.isNative) {
      return {
        from,
        to: recipient,
        value: this.transaction.parseEther(amount),
        chainId,
        rpcUrl
      };
    }

    const tokenAddress = token.address;
    if (!tokenAddress || !isValidAddress(tokenAddress)) {
      throw new Error('通证合约地址无效');
    }

    const decimals = Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : 18;
    const valueHex = this.transaction.parseUnits(amount, decimals, token.symbol || '通证');

    return {
      from,
      to: tokenAddress,
      value: '0x0',
      data: encodeErc20Transfer(recipient, valueHex),
      chainId,
      rpcUrl,
      token: {
        address: tokenAddress,
        symbol: token.symbol || '',
        name: token.name || token.symbol || '',
        decimals,
        amount: valueHex,
        recipient
      }
    };
  }

  formatTransactionError(error) {
    const rawMessage = String(error?.reason || error?.shortMessage || error?.message || error || '').trim();
    const revertMessage = this.extractRevertMessage(rawMessage);
    const message = revertMessage || rawMessage;
    const normalized = message.toLowerCase();

    if (normalized.includes('transfer amount exceeds balance')) {
      return '发送失败: 通证余额不足';
    }
    if (normalized.includes('insufficient funds')) {
      return '发送失败: 余额不足，无法支付金额或矿工费';
    }
    if (normalized.includes('user rejected') || normalized.includes('user denied')) {
      return '发送失败: 用户已取消交易';
    }
    if (normalized.includes('execution reverted')) {
      return `发送失败: ${message.replace(/^execution reverted:?\s*/i, '') || '交易被合约拒绝'}`;
    }
    if (normalized.includes('estimategas')) {
      return '发送失败: 交易预估失败，请检查余额、授权或网络状态';
    }

    return `发送失败: ${message || '交易提交失败'}`;
  }

  extractRevertMessage(message) {
    if (!message) return '';
    const reasonMatch = message.match(/reason="([^"]+)"/);
    if (reasonMatch?.[1]) {
      return reasonMatch[1];
    }
    const revertedMatch = message.match(/execution reverted:\s*"([^"]+)"/i);
    if (revertedMatch?.[1]) {
      return revertedMatch[1];
    }
    const argsMatch = message.match(/"args":\s*\[\s*"([^"]+)"/);
    if (argsMatch?.[1]) {
      return argsMatch[1];
    }
    return '';
  }
}

function encodeErc20Transfer(recipient, amountHex) {
  const addressData = recipient.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amountData = BigInt(amountHex).toString(16).padStart(64, '0');
  return `${ERC20_TRANSFER_SELECTOR}${addressData}${amountData}`;
}
