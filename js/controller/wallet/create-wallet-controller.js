import { shortenAddress } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { showPage, showError, showSuccess, getPageOrigin } from '../../common/ui/index.js';

export class CreateWalletController {
  constructor({ wallet, onCreated }) {
    this.wallet = wallet;
    this.onCreated = onCreated;
    this.mpcContacts = [];
    this.selectedMpcParticipants = [];
  }

  bindEvents() {
    window.refreshCreateWalletMpcContacts = async () => {
      await this.loadMpcContacts();
    };

    const setPasswordBtn = document.getElementById('setPasswordBtn');
    if (setPasswordBtn) {
      setPasswordBtn.addEventListener('click', async () => {
        await this.handleCreateWallet();
      });
    }

    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    if (walletTypeSelect) {
      walletTypeSelect.addEventListener('change', () => {
        const origin = getPageOrigin('setPasswordPage', 'welcome');
        this.applyCreateWalletType(walletTypeSelect.value, origin);
      });
    }
    this.bindWalletTypeDropdown();
    this.bindMpcParticipantsSelector();

    const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
    if (cancelPasswordBtn) {
      cancelPasswordBtn.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    const confirmInput = document.getElementById('confirmPassword');
    if (confirmInput) {
      confirmInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          await this.handleCreateWallet();
        }
      });
    }
  }

  async handleCreateWallet() {
    const name = document.getElementById('setWalletName')?.value.trim() || '主钱包';
    const password = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    const useExistingPassword = origin === 'accounts';
    const walletType = this.getCreateWalletType();

    if (origin !== 'accounts' && walletType === 'mpc') {
      showError('请先创建 HD 钱包，再添加 MPC 钱包');
      return;
    }

    if (!password) {
      showError(useExistingPassword ? '请输入当前密码' : '请输入密码');
      return;
    }

    if (password.length < 8) {
      showError('密码至少需要8位字符');
      return;
    }

    if (!useExistingPassword) {
      if (!confirmPassword) {
        showError('请再次输入密码');
        return;
      }

      if (password !== confirmPassword) {
        showError('两次密码不一致');
        return;
      }
    }

    try {
      if (useExistingPassword) {
        await this.verifyExistingPassword(password);
      }

      if (walletType === 'mpc') {
        await this.handleCreateMpcWallet({
          name,
          password
        });
        return;
      }

      await this.wallet.createHDWallet(name, password);

      showSuccess('钱包创建成功');
      showPage('walletPage');

      this.resetForm();

      if (this.onCreated) {
        await this.onCreated();
      }
    } catch (error) {
      showError('创建失败: ' + error.message);
    }
  }

  handleCancel() {
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    if (origin === 'accounts') {
      showPage('accountsPage');
      return;
    }

    showPage('welcomePage');
  }

  resetForm() {
    const nameInput = document.getElementById('setWalletName');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcWalletIdInput = document.getElementById('mpcCreateWalletIdInput');
    const mpcThresholdInput = document.getElementById('mpcCreateThresholdInput');
    const mpcCurveSelect = document.getElementById('mpcCreateCurveSelect');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (nameInput) nameInput.value = '主钱包';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (walletTypeSelect) walletTypeSelect.value = 'hd';
    if (mpcWalletIdInput) mpcWalletIdInput.value = '';
    if (mpcThresholdInput) mpcThresholdInput.value = '';
    if (mpcCurveSelect) mpcCurveSelect.value = 'secp256k1';
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
    this.selectedMpcParticipants = [];
    this.renderMpcParticipantSelection();
    window.refreshWalletSelects?.();
    this.applyCreateWalletType('hd', getPageOrigin('setPasswordPage', 'welcome'));
  }

  async verifyExistingPassword(password) {
    const account = await this.wallet.getCurrentAccount();
    if (!account?.id) {
      throw new Error('未找到当前账户');
    }
    await this.wallet.exportPrivateKey(account.id, password);
  }

  getCreateWalletType() {
    const select = document.getElementById('createWalletTypeSelect');
    const value = String(select?.value || 'hd').toLowerCase();
    return value === 'mpc' ? 'mpc' : 'hd';
  }

  applyCreateWalletType(type, origin) {
    const normalized = String(type || 'hd').toLowerCase() === 'mpc' ? 'mpc' : 'hd';
    const group = document.getElementById('createWalletTypeGroup');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const resultEl = document.getElementById('mpcCreateWalletResult');
    const setPasswordBtn = document.getElementById('setPasswordBtn');
    const isAccounts = origin === 'accounts';
    if (group) {
      group.classList.toggle('hidden', !isAccounts);
    }
    if (mpcFields) {
      mpcFields.classList.toggle('hidden', normalized !== 'mpc');
    }
    if (resultEl) {
      resultEl.classList.toggle('hidden', normalized !== 'mpc');
    }
    if (setPasswordBtn && isAccounts) {
      setPasswordBtn.textContent = normalized === 'mpc' ? '创建 MPC 钱包' : '创建钱包';
    }
    this.updateWalletTypeMenu(normalized);
    if (normalized === 'mpc') {
      this.loadMpcContacts().catch((error) => {
        console.error('[CreateWalletController] 加载 MPC 联系人失败:', error);
      });
    } else {
      this.closeMpcParticipantsMenu();
    }
  }

  bindWalletTypeDropdown() {
    const trigger = document.getElementById('createWalletTypeTrigger');
    const menu = document.getElementById('createWalletTypeMenu');
    const select = document.getElementById('createWalletTypeSelect');
    if (!trigger || !menu || !select) return;

    const closeMenu = () => {
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      if (isHidden) {
        menu.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });

    menu.addEventListener('click', (event) => {
      const option = event.target.closest('.network-option');
      if (!option) return;
      const nextType = option.dataset.walletType;
      if (!nextType) return;
      if (select.value !== nextType) {
        select.value = nextType;
        select.dispatchEvent(new Event('change'));
      } else {
        const origin = getPageOrigin('setPasswordPage', 'welcome');
        this.applyCreateWalletType(nextType, origin);
      }
      closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (trigger.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
    });
  }

  updateWalletTypeMenu(type) {
    const label = document.getElementById('createWalletTypeLabel');
    if (label) {
      label.textContent = type === 'mpc' ? 'MPC Wallet' : 'HD Wallet';
    }
    const menu = document.getElementById('createWalletTypeMenu');
    if (!menu) return;
    menu.querySelectorAll('.network-option').forEach(option => {
      const isActive = option.dataset.walletType === type;
      option.classList.toggle('active', isActive);
    });
  }

  bindMpcParticipantsSelector() {
    const trigger = document.getElementById('mpcCreateParticipantsTrigger');
    const menu = document.getElementById('mpcCreateParticipantsMenu');
    if (trigger && menu) {
      trigger.addEventListener('click', async (event) => {
        event.stopPropagation();
        const hidden = menu.classList.contains('hidden');
        if (hidden) {
          await this.loadMpcContacts();
          this.openMpcParticipantsMenu();
        } else {
          this.closeMpcParticipantsMenu();
        }
      });
      document.addEventListener('click', (event) => {
        if (menu.classList.contains('hidden')) return;
        if (trigger.contains(event.target) || menu.contains(event.target)) return;
        this.closeMpcParticipantsMenu();
      });
      menu.addEventListener('click', (event) => {
        const addContactAction = event.target.closest('[data-action="add-contact"]');
        if (!addContactAction) return;
        this.closeMpcParticipantsMenu();
        const contactsPage = document.getElementById('contactsPage');
        if (contactsPage) {
          contactsPage.dataset.returnPage = 'setPasswordPage';
        }
        const contactsBtn = document.getElementById('contactsBtn');
        if (contactsBtn) {
          contactsBtn.click();
        } else {
          showPage('contactsPage');
        }
        const openAddBtn = document.getElementById('openAddContactBtn');
        if (openAddBtn) {
          setTimeout(() => openAddBtn.click(), 0);
        }
      });
    }
  }

  async loadMpcContacts() {
    const contacts = await this.wallet.getContacts();
    this.mpcContacts = Array.isArray(contacts)
      ? contacts.filter(item => String(item?.address || '').trim())
      : [];
    const addressSet = new Set(this.mpcContacts.map(item => String(item.address || '').trim()));
    this.selectedMpcParticipants = this.selectedMpcParticipants.filter(address => addressSet.has(address));
    this.renderMpcParticipantsMenu();
    this.renderMpcParticipantSelection();
  }

  renderMpcParticipantsMenu() {
    const menu = document.getElementById('mpcCreateParticipantsMenu');
    if (!menu) return;
    const contactOptions = this.mpcContacts.length
      ? this.mpcContacts.map((contact) => {
        const address = String(contact.address || '').trim();
        const label = contact.name
          ? `${escapeHtml(contact.name)} (${escapeHtml(shortenAddress(address))})`
          : escapeHtml(shortenAddress(address));
        const active = this.selectedMpcParticipants.includes(address);
        return `
          <button
            type="button"
            class="network-option mpc-contact-option${active ? ' active' : ''}"
            data-address="${escapeHtml(address)}"
          >
            <span>${label}</span>
          </button>
        `;
      }).join('')
      : '<div class="network-option mpc-contact-option-empty" aria-disabled="true">暂无联系人</div>';

    menu.innerHTML = `
      ${contactOptions}
      <div class="mpc-contact-menu-footer">
        <button
          type="button"
          class="network-option mpc-contact-menu-action"
          data-action="add-contact"
          aria-label="添加联系人"
          title="添加联系人"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
    `;
    menu.querySelectorAll('.mpc-contact-option').forEach((button) => {
      button.addEventListener('click', () => {
        const address = String(button.dataset.address || '').trim();
        if (!address) return;
        if (this.selectedMpcParticipants.includes(address)) {
          this.selectedMpcParticipants = this.selectedMpcParticipants.filter(item => item !== address);
        } else {
          this.selectedMpcParticipants = [...this.selectedMpcParticipants, address];
        }
        this.renderMpcParticipantsMenu();
        this.renderMpcParticipantSelection();
      });
    });
  }

  renderMpcParticipantSelection() {
    const label = document.getElementById('mpcCreateParticipantsLabel');
    const selected = document.getElementById('mpcCreateParticipantsSelected');
    const selectedContacts = this.selectedMpcParticipants
      .map((address) => this.mpcContacts.find((item) => String(item?.address || '').trim() === address))
      .filter(Boolean);

    if (label) {
      label.textContent = selectedContacts.length ? `已选 ${selectedContacts.length} 位联系人` : '请选择联系人';
    }
    if (selected) {
      if (!selectedContacts.length) {
        selected.innerHTML = '';
        selected.classList.add('hidden');
      } else {
        selected.classList.remove('hidden');
        selected.innerHTML = selectedContacts.map((contact) => {
          const address = String(contact.address || '').trim();
          const short = shortenAddress(address);
          const name = contact.name ? escapeHtml(contact.name) : '未命名联系人';
          return `
            <div class="mpc-contact-chip">
              <span class="mpc-contact-chip-label">
                <span class="mpc-contact-chip-name">${name}</span>
                <span class="mpc-contact-chip-address">${escapeHtml(short)}</span>
              </span>
              <button
                type="button"
                class="mpc-contact-chip-remove"
                data-address="${escapeHtml(address)}"
                aria-label="移除联系人"
                title="移除"
              >×</button>
            </div>
          `;
        }).join('');
        selected.querySelectorAll('.mpc-contact-chip-remove').forEach((button) => {
          button.addEventListener('click', () => {
            const address = String(button.dataset.address || '').trim();
            this.selectedMpcParticipants = this.selectedMpcParticipants.filter(item => item !== address);
            this.renderMpcParticipantsMenu();
            this.renderMpcParticipantSelection();
          });
        });
      }
    }
  }

  openMpcParticipantsMenu() {
    const menu = document.getElementById('mpcCreateParticipantsMenu');
    const trigger = document.getElementById('mpcCreateParticipantsTrigger');
    if (!menu || !trigger) return;
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }

  closeMpcParticipantsMenu() {
    const menu = document.getElementById('mpcCreateParticipantsMenu');
    const trigger = document.getElementById('mpcCreateParticipantsTrigger');
    if (!menu || !trigger) return;
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }

  async handleCreateMpcWallet({ name, password }) {
    const walletIdInput = document.getElementById('mpcCreateWalletIdInput');
    const thresholdInput = document.getElementById('mpcCreateThresholdInput');
    const curveSelect = document.getElementById('mpcCreateCurveSelect');
    const resultEl = document.getElementById('mpcCreateWalletResult');

    const walletId = String(walletIdInput?.value || '').trim();
    const participants = [...this.selectedMpcParticipants];
    const threshold = Number(thresholdInput?.value || 0);
    const curve = String(curveSelect?.value || 'secp256k1').trim();

    if (!participants.length) {
      showError('请先选择联系人');
      return;
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      showError('门限必须大于 0');
      return;
    }
    if (threshold > participants.length) {
      showError('门限不能大于参与者数量');
      return;
    }

    const response = await this.wallet.createMpcWallet({
      walletId,
      name,
      participants,
      threshold,
      curve
    });
    if (!response?.success) {
      throw new Error(response?.error || '创建失败');
    }

    const createdId = response?.wallet?.id || walletId || '-';
    const sessionId = response?.session?.id || response?.session?.sessionId || '-';
    if (resultEl) {
      resultEl.textContent = `MPC 钱包已创建: ${createdId} · Keygen 会话: ${sessionId}`;
      resultEl.classList.remove('hidden');
    }

    showSuccess('MPC 钱包已创建');
    showPage('accountsPage');
    this.resetForm();
    if (this.onCreated) {
      await this.onCreated();
    }
  }
}
