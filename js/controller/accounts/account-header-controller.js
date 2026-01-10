import { generateAvatar } from '../../common/chain/index.js';

export class AccountHeaderController {
  constructor({ wallet } = {}) {
    this.wallet = wallet;
  }

  async refreshHeader() {
    if (!this.wallet) return;
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) return;
      this.updateHeader(account);
    } catch (error) {
      console.warn('[AccountHeaderController] 刷新账户信息失败:', error);
    }
  }

  updateHeader(account) {
    const nameEl = document.getElementById('accountName');
    if (nameEl) {
      nameEl.textContent = account?.name || '未知账户';
    }

    const avatarEl = document.getElementById('walletAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = '';
      if (account?.address) {
        try {
          const size = avatarEl.clientWidth || 40;
          const canvas = generateAvatar(account.address, size);
          avatarEl.appendChild(canvas);
        } catch (error) {
          avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
        }
      } else {
        avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
      }
    }
  }
}
