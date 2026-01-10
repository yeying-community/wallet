import { isValidAddress } from '../../common/chain/index.js';
import { showError, showWaiting, hideToast, hideWaiting } from '../../common/ui/index.js';
import { isWalletLockedError } from '../../common/errors/index.js';

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

  async handleSendTransaction({ requestPassword, onSuccess, silentBalanceRefresh = false } = {}) {
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

      const txHash = await this.transaction.sendTransaction({
        from: account.address,
        to: recipient,
        value: this.transaction.parseEther(amount),
        chainId: chainId,
        rpcUrl: rpcUrl
      });

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
          await this.wallet.unlock(password, account?.id);
        } catch (unlockError) {
          console.error('[TransactionSendController] 解锁失败:', unlockError);
          showError('密码错误');
          return;
        }
        try {
          await sendTransaction();
        } catch (retryError) {
          console.error('[TransactionSendController] 重试发送失败:', retryError);
          showError('发送失败: ' + retryError.message);
        }
        return;
      }
      showError('发送失败: ' + error.message);
    }
  }
}
