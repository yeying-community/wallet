import { showSuccess, showError } from '../../common/ui/index.js';

export class ProfileSettingsController {
  constructor({ wallet }) {
    this.wallet = wallet;
  }

  bindEvents() {
    document.getElementById('saveProfileEmailBtn')?.addEventListener('click', () => this.save());
  }

  async load() {
    try {
      const profile = await this.wallet.getProfile();
      const input = document.getElementById('profileEmailInput');
      if (input) input.value = profile.email || '';
    } catch (error) {
      console.error('[ProfileSettings] load failed:', error);
    }
  }

  async save() {
    try {
      const email = document.getElementById('profileEmailInput')?.value || '';
      await this.wallet.updateProfileEmail(email);
      showSuccess('邮箱已保存');
    } catch (error) {
      showError('保存失败: ' + error.message);
    }
  }
}
