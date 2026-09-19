import { shortenAddress } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import {
  showPage,
  showError,
  showSuccess,
  getCurrentPage,
  getPageOrigin,
  setPageOrigin
} from '../../common/ui/index.js';
import { DEFAULT_MPC_COORDINATOR_ENDPOINT } from '../setting/settings-utils.js';

const CREATE_WALLET_DRAFT_KEY = 'createWalletDraft';
const GENERATED_WALLET_NAME_PATTERN = /^(hd|mpc)-\d{4}$/;

export class CreateWalletController {
  constructor({ wallet, onCreated, onReturnToAccounts, promptPassword }) {
    this.wallet = wallet;
    this.onCreated = onCreated;
    this.onReturnToAccounts = onReturnToAccounts;
    this.promptPassword = promptPassword;
    this.mpcContacts = [];
    this.selectedMpcParticipants = [];
    this.currentMpcAccount = null;
  }

  normalizeAddress(address) {
    const normalized = String(address || '').trim();
    return normalized ? normalized.toLowerCase() : '';
  }

  dedupeAddresses(addresses = []) {
    const unique = [];
    const seen = new Set();
    for (const item of addresses) {
      const raw = String(item || '').trim();
      const key = this.normalizeAddress(raw);
      if (!raw || !key || seen.has(key)) continue;
      seen.add(key);
      unique.push(raw);
    }
    return unique;
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
    this.bindTronNetworkDropdown();
    this.bindSolanaNetworkDropdown();
    this.bindMpcParticipantsSelector();
    this.bindDraftPersistence();

    const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
    if (cancelPasswordBtn) {
      cancelPasswordBtn.addEventListener('click', async () => {
        await this.handleCancel();
      });
    }

    const nameInput = document.getElementById('setWalletName');
    if (nameInput) {
      nameInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          await this.handleCreateWallet();
        }
      });
    }
  }

  async handleCreateWallet() {
    const rawName = String(document.getElementById('setWalletName')?.value || '').trim();
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    const useExistingPassword = origin === 'accounts';
    const walletType = this.getCreateWalletType();
    const isMpc = walletType === 'mpc';
    const isTron = walletType === 'tron';
    const isSolana = walletType === 'solana';
    const name = rawName || this.generateDefaultWalletName(walletType);

    if (origin !== 'accounts' && isMpc) {
      showError('请先创建 HD 钱包，再添加 MPC 钱包');
      return;
    }

    if (isMpc && !name) {
      showError('请输入 MPC 钱包名称');
      return;
    }

    if (isMpc) {
      const canCreate = await this.validateMpcCreateForm();
      if (!canCreate) return;
    }

    if (!this.promptPassword) {
      showError(useExistingPassword ? '请输入当前钱包密码' : '请设置钱包密码');
      return;
    }
    const password = await this.promptPassword({
      title: '创建钱包',
      confirmText: '创建钱包',
      placeholder: useExistingPassword ? '输入当前钱包密码' : '至少8位字符',
      onConfirm: async (value) => {
        if (!value || value.length < 8) {
          throw new Error('密码至少需要8位字符');
        }
        if (useExistingPassword) {
          await this.verifyExistingPassword(value);
        }
      }
    });
    if (!password) return;

    try {
      if (isMpc) {
        await this.handleCreateMpcWallet({
          name,
          password
        });
        return;
      }

      if (isTron) {
        const tronReference = this.getTronReference();
        await this.wallet.createTronHDWallet(name, password, { tronReference });
      } else if (isSolana) {
        const solanaReference = this.getSolanaReference();
        await this.wallet.createSolanaHDWallet(name, password, { solanaReference });
      } else {
        await this.wallet.createHDWallet(name, password);
      }

      showSuccess(isTron ? 'Tron 钱包创建成功' : (isSolana ? 'Solana 钱包创建成功' : '钱包创建成功'));
      showPage('walletPage');

      this.resetForm();

      if (this.onCreated) {
        await this.onCreated();
      }
    } catch (error) {
      showError('创建失败: ' + error.message);
    }
  }

  async handleCancel() {
    await this.clearDraft();
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    if (origin === 'accounts') {
      if (this.onReturnToAccounts) {
        await this.onReturnToAccounts();
        return;
      }
      showPage('accountsPage');
      return;
    }

    showPage('welcomePage');
  }

  resetForm() {
    void this.clearDraft();
    const nameInput = document.getElementById('setWalletName');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcThresholdInput = document.getElementById('mpcCreateThresholdInput');
    const mpcCurveSelect = document.getElementById('mpcCreateCurveSelect');
    const mpcCoordinatorEndpointInput = document.getElementById('mpcCreateCoordinatorEndpointInput');
    const mpcAdvancedOptions = document.querySelector('.mpc-advanced-options');
    const mpcResult = document.getElementById('mpcCreateWalletResult');
    const tronNetworkSelect = document.getElementById('tronCreateNetworkSelect');
    const solanaNetworkSelect = document.getElementById('solanaCreateNetworkSelect');

    if (nameInput) nameInput.value = this.generateDefaultWalletName('hd');
    if (walletTypeSelect) walletTypeSelect.value = 'hd';
    if (mpcThresholdInput) mpcThresholdInput.value = '';
    if (mpcCurveSelect) mpcCurveSelect.value = 'secp256k1';
    if (mpcCoordinatorEndpointInput) mpcCoordinatorEndpointInput.value = '';
    if (mpcAdvancedOptions) mpcAdvancedOptions.open = false;
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
    if (tronNetworkSelect) tronNetworkSelect.value = 'mainnet';
    if (solanaNetworkSelect) solanaNetworkSelect.value = 'mainnet-beta';
    this.selectedMpcParticipants = [];
    this.currentMpcAccount = null;
    this.renderMpcParticipantSelection();
    globalThis.window?.refreshWalletSelects?.();
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
    if (value === 'mpc') return 'mpc';
    if (value === 'tron' || value === 'tronhd' || value === 'tron-hd') return 'tron';
    if (value === 'solana') return 'solana';
    return 'hd';
  }

  getTronReference() {
    const select = document.getElementById('tronCreateNetworkSelect');
    const value = String(select?.value || 'mainnet').toLowerCase();
    if (value === 'shasta' || value === 'nile') return value;
    return 'mainnet';
  }

  getSolanaReference() {
    const select = document.getElementById('solanaCreateNetworkSelect');
    const value = String(select?.value || 'mainnet-beta').toLowerCase();
    if (value === 'devnet' || value === 'testnet') return value;
    return 'mainnet-beta';
  }

  generateDefaultWalletName(type = 'hd') {
    const normalized = String(type || '').toLowerCase();
    const prefix = normalized === 'mpc'
      ? 'mpc'
      : (normalized === 'tron' ? 'tron' : (normalized === 'solana' ? 'sol' : 'hd'));
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `${prefix}-${suffix}`;
  }

  shouldReplaceWalletNameForType(name, type) {
    const normalized = String(type || '').toLowerCase();
    let expectedPrefix = 'hd';
    if (normalized === 'mpc') expectedPrefix = 'mpc';
    else if (normalized === 'tron') expectedPrefix = 'tron';
    else if (normalized === 'solana') expectedPrefix = 'sol';
    const current = String(name || '').trim();
    if (!current || current === '主钱包') return true;
    if (!GENERATED_WALLET_NAME_PATTERN.test(current)) return false;
    return !current.startsWith(`${expectedPrefix}-`);
  }

  ensureDefaultWalletName(type = this.getCreateWalletType()) {
    const input = document.getElementById('setWalletName');
    if (!input) return;
    if (this.shouldReplaceWalletNameForType(input.value, type)) {
      input.value = this.generateDefaultWalletName(type);
    }
  }

  applyCreateWalletType(type, origin) {
    const value = String(type || 'hd').toLowerCase();
    let normalized = 'hd';
    if (value === 'mpc') normalized = 'mpc';
    else if (value === 'tron' || value === 'tronhd' || value === 'tron-hd') normalized = 'tron';
    else if (value === 'solana') normalized = 'solana';
    const group = document.getElementById('createWalletTypeGroup');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const tronFields = document.getElementById('tronCreateWalletFields');
    const solanaFields = document.getElementById('solanaCreateWalletFields');
    const resultEl = document.getElementById('mpcCreateWalletResult');
    const setPasswordBtn = document.getElementById('setPasswordBtn');
    const hint = document.getElementById('setPasswordHint');
    const isAccounts = origin === 'accounts';
    this.ensureDefaultWalletName(normalized);
    if (group) {
      group.classList.toggle('hidden', !isAccounts);
    }
    if (mpcFields) {
      mpcFields.classList.toggle('hidden', normalized !== 'mpc');
    }
    if (tronFields) {
      tronFields.classList.toggle('hidden', normalized !== 'tron');
    }
    if (solanaFields) {
      solanaFields.classList.toggle('hidden', normalized !== 'solana');
    }
    if (resultEl) {
      resultEl.classList.toggle('hidden', normalized !== 'mpc');
    }
    if (hint) {
      if (normalized === 'mpc') hint.textContent = '请填写钱包名称和参与方';
      else if (normalized === 'tron') hint.textContent = '请填写 Tron 钱包名称';
      else if (normalized === 'solana') hint.textContent = '请填写 Solana 钱包名称';
      else hint.textContent = '请填写钱包名称';
    }
    if (setPasswordBtn && isAccounts) {
      setPasswordBtn.textContent = '创建钱包';
    }
    this.updateWalletTypeMenu(normalized);
    if (origin === 'accounts' && getCurrentPage() === 'setPasswordPage') {
      void this.saveDraft();
    }
    if (normalized === 'mpc') {
      Promise.all([
        this.loadMpcContacts(),
        this.loadMpcCreateDefaults()
      ]).catch((error) => {
        console.error('[CreateWalletController] 加载 MPC 创建配置失败:', error);
      });
    } else {
      this.closeMpcParticipantsMenu();
    }
  }

  async loadMpcCreateDefaults() {
    const endpointInput = document.getElementById('mpcCreateCoordinatorEndpointInput');
    if (!endpointInput) return;
    const currentEndpoint = String(endpointInput.value || '').trim();
    if (currentEndpoint && currentEndpoint !== DEFAULT_MPC_COORDINATOR_ENDPOINT) return;
    try {
      const settings = await this.wallet.getMpcSettings?.();
      endpointInput.value = settings?.coordinatorEndpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT;
    } catch {
      endpointInput.value = DEFAULT_MPC_COORDINATOR_ENDPOINT;
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
    let label = 'HD Wallet';
    if (type === 'mpc') label = 'MPC Wallet';
    else if (type === 'tron') label = 'Tron HD';
    else if (type === 'solana') label = 'Solana 钱包';
    const labelEl = document.getElementById('createWalletTypeLabel');
    if (labelEl) {
      labelEl.textContent = label;
    }
    const menu = document.getElementById('createWalletTypeMenu');
    if (!menu) return;
    menu.querySelectorAll('.network-option').forEach(option => {
      const isActive = option.dataset.walletType === type;
      option.classList.toggle('active', isActive);
    });
  }

  bindTronNetworkDropdown() {
    const trigger = document.getElementById('tronCreateNetworkTrigger');
    const menu = document.getElementById('tronCreateNetworkMenu');
    const select = document.getElementById('tronCreateNetworkSelect');
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
      const nextRef = option.dataset.tronReference;
      if (!nextRef) return;
      if (select.value !== nextRef) {
        select.value = nextRef;
        const labelEl = document.getElementById('tronCreateNetworkLabel');
        if (labelEl) labelEl.textContent = option.textContent.trim();
        menu.querySelectorAll('.network-option').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.tronReference === nextRef);
        });
        void this.saveDraft();
      }
      closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (trigger.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
    });
  }

  bindSolanaNetworkDropdown() {
    const trigger = document.getElementById('solanaCreateNetworkTrigger');
    const menu = document.getElementById('solanaCreateNetworkMenu');
    const select = document.getElementById('solanaCreateNetworkSelect');
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
      const nextRef = option.dataset.solanaReference;
      if (!nextRef) return;
      if (select.value !== nextRef) {
        select.value = nextRef;
        const labelEl = document.getElementById('solanaCreateNetworkLabel');
        if (labelEl) labelEl.textContent = option.textContent.trim();
        menu.querySelectorAll('.network-option').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.solanaReference === nextRef);
        });
        void this.saveDraft();
      }
      closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (trigger.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
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
    const currentAccount = await this.wallet.getCurrentAccount();
    const currentAddress = String(currentAccount?.address || '').trim();
    this.currentMpcAccount = currentAddress
      ? {
          address: currentAddress,
          name: String(currentAccount?.name || '').trim() || '当前账户',
        }
      : null;
    const contacts = await this.wallet.getContacts();
    const selfKey = this.normalizeAddress(currentAddress);
    this.mpcContacts = Array.isArray(contacts)
      ? contacts.filter(item => String(item?.address || '').trim())
          .filter(item => this.normalizeAddress(item.address) !== selfKey)
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
        const name = contact.name ? escapeHtml(contact.name) : '未命名联系人';
        const short = escapeHtml(shortenAddress(address));
        const active = this.selectedMpcParticipants.includes(address);
        return `
          <button
            type="button"
            class="network-option mpc-contact-option${active ? ' active' : ''}"
            data-address="${escapeHtml(address)}"
          >
            <span class="mpc-contact-option-label">
              <span class="mpc-contact-chip-name">${name}</span>
              <span class="mpc-contact-chip-address">${short}</span>
            </span>
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
        void this.saveDraft();
      });
    });
  }

  renderMpcParticipantSelection() {
    const label = document.getElementById('mpcCreateParticipantsLabel');
    const selected = document.getElementById('mpcCreateParticipantsSelected');
    const selectedContacts = this.selectedMpcParticipants
      .map((address) => this.mpcContacts.find((item) => String(item?.address || '').trim() === address))
      .filter(Boolean);
    const selfParticipant = this.currentMpcAccount
      ? {
          ...this.currentMpcAccount,
          self: true,
        }
      : null;

    if (label) {
      if (selectedContacts.length > 0) {
        label.textContent = `已选择 ${selectedContacts.length} 位联系人`;
      } else {
        label.textContent = '请选择联系人';
      }
    }
    if (selected) {
      const chips = [];
      if (selfParticipant) {
        chips.push(`
          <div class="mpc-contact-chip mpc-contact-chip-self">
            <span class="mpc-contact-chip-label">
              <span class="mpc-contact-chip-name">${escapeHtml(selfParticipant.name)}</span>
              <span class="mpc-contact-chip-address">${escapeHtml(shortenAddress(selfParticipant.address))}</span>
            </span>
          </div>
        `);
      }
      if (!selectedContacts.length && !selfParticipant) {
        selected.innerHTML = '';
        selected.classList.add('hidden');
      } else {
        selected.classList.remove('hidden');
        chips.push(...selectedContacts.map((contact) => {
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
        }));
        selected.innerHTML = chips.join('');
        selected.querySelectorAll('.mpc-contact-chip-remove').forEach((button) => {
          button.addEventListener('click', () => {
            const address = String(button.dataset.address || '').trim();
            this.selectedMpcParticipants = this.selectedMpcParticipants.filter(item => item !== address);
            this.renderMpcParticipantsMenu();
            this.renderMpcParticipantSelection();
            void this.saveDraft();
          });
        });
      }
    }
    this.updateMpcThresholdDefault(Boolean(selfParticipant), selectedContacts.length);
  }

  bindDraftPersistence() {
    const ids = [
      'setWalletName',
      'mpcCreateThresholdInput',
      'mpcCreateCurveSelect',
      'mpcCreateCoordinatorEndpointInput',
    ];
    ids.forEach((id) => {
      const element = document.getElementById(id);
      element?.addEventListener('input', () => void this.saveDraft());
      element?.addEventListener('change', () => void this.saveDraft());
    });
    document.querySelector('.mpc-advanced-options')
      ?.addEventListener('toggle', () => void this.saveDraft());
  }

  buildDraft() {
    if (getPageOrigin('setPasswordPage', 'welcome') !== 'accounts') return null;
    return {
      active: true,
      walletType: this.getCreateWalletType(),
      name: String(document.getElementById('setWalletName')?.value || '').trim(),
      participants: [...this.selectedMpcParticipants],
      threshold: String(document.getElementById('mpcCreateThresholdInput')?.value || '').trim(),
      curve: String(document.getElementById('mpcCreateCurveSelect')?.value || 'secp256k1'),
      coordinatorEndpoint: String(document.getElementById('mpcCreateCoordinatorEndpointInput')?.value || '').trim(),
      advancedOpen: Boolean(document.querySelector('.mpc-advanced-options')?.open),
      tronReference: this.getTronReference(),
    };
  }

  async saveDraft() {
    const draft = this.buildDraft();
    if (!draft || !globalThis.chrome?.storage?.session) return;
    try {
      await globalThis.chrome.storage.session.set({ [CREATE_WALLET_DRAFT_KEY]: draft });
    } catch (error) {
      console.warn('[CreateWalletController] 保存创建草稿失败:', error);
    }
  }

  async clearDraft() {
    if (!globalThis.chrome?.storage?.session) return;
    try {
      await globalThis.chrome.storage.session.remove(CREATE_WALLET_DRAFT_KEY);
    } catch (error) {
      console.warn('[CreateWalletController] 清除创建草稿失败:', error);
    }
  }

  async restoreDraft() {
    if (!globalThis.chrome?.storage?.session) return false;
    let draft;
    try {
      const stored = await globalThis.chrome.storage.session.get(CREATE_WALLET_DRAFT_KEY);
      draft = stored?.[CREATE_WALLET_DRAFT_KEY];
    } catch (error) {
      console.warn('[CreateWalletController] 读取创建草稿失败:', error);
      return false;
    }
    if (!draft?.active) return false;

    setPageOrigin('setPasswordPage', 'accounts');
    const setValue = (id, value) => {
      const element = document.getElementById(id);
      if (element && value !== undefined && value !== null) element.value = String(value);
    };
    setValue('setWalletName', draft.name || this.generateDefaultWalletName(draft.walletType));
    setValue('mpcCreateThresholdInput', draft.threshold || '');
    setValue('mpcCreateCurveSelect', draft.curve || 'secp256k1');
    setValue('mpcCreateCoordinatorEndpointInput', draft.coordinatorEndpoint || '');
    setValue('createWalletTypeSelect', draft.walletType === 'mpc' ? 'mpc' : (draft.walletType === 'tron' ? 'tron' : 'hd'));
    if (draft.tronReference) {
      setValue('tronCreateNetworkSelect', draft.tronReference);
      const tronLabel = document.getElementById('tronCreateNetworkLabel');
      if (tronLabel) {
        const opt = document.querySelector(`#tronCreateNetworkMenu [data-tron-reference="${draft.tronReference}"]`);
        if (opt) tronLabel.textContent = opt.textContent.trim();
      }
    }
    this.selectedMpcParticipants = Array.isArray(draft.participants)
      ? this.dedupeAddresses(draft.participants)
      : [];
    const advanced = document.querySelector('.mpc-advanced-options');
    if (advanced) advanced.open = Boolean(draft.advancedOpen);

    this.applyCreateWalletType(draft.walletType, 'accounts');
    await this.loadMpcContacts();
    showPage('setPasswordPage');
    return true;
  }

  updateMpcThresholdDefault(hasSelf, selectedCount) {
    const thresholdInput = document.getElementById('mpcCreateThresholdInput');
    if (!thresholdInput) return;
    const current = Number(thresholdInput.value || 0);
    const total = (hasSelf ? 1 : 0) + Number(selectedCount || 0);
    if (total <= 0) return;
    const defaultThreshold = total <= 2 ? total : Math.ceil(total / 2);
    const minThreshold = Math.min(2, total);
    if (Number.isFinite(current) && current >= minThreshold && current <= total) return;
    thresholdInput.value = String(Math.max(minThreshold, defaultThreshold));
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

  async validateMpcCreateForm() {
    const thresholdInput = document.getElementById('mpcCreateThresholdInput');
    const currentAddress =
      String(this.currentMpcAccount?.address || '').trim() ||
      String((await this.wallet.getCurrentAccount())?.address || '').trim();
    const participants = this.dedupeAddresses([
      currentAddress,
      ...this.selectedMpcParticipants,
    ]);
    const threshold = Number(thresholdInput?.value || 0);

    if (!currentAddress) {
      showError('未找到当前账户');
      return false;
    }
    if (!this.selectedMpcParticipants.length) {
      showError('请先选择联系人');
      return false;
    }
    if (!Number.isFinite(threshold) || threshold < 2) {
      showError('门限必须至少为 2');
      return false;
    }
    if (threshold > participants.length) {
      showError('门限不能大于参与者数量');
      return false;
    }
    try {
      this.readMpcCreateAdvancedOptions();
    } catch (error) {
      showError(error?.message || '协调器地址格式不正确');
      return false;
    }
    return true;
  }

  async handleCreateMpcWallet({ name, password }) {
    const thresholdInput = document.getElementById('mpcCreateThresholdInput');
    const curveSelect = document.getElementById('mpcCreateCurveSelect');
    const resultEl = document.getElementById('mpcCreateWalletResult');

    const currentAddress =
      String(this.currentMpcAccount?.address || '').trim() ||
      String((await this.wallet.getCurrentAccount())?.address || '').trim();
    const participants = this.dedupeAddresses([
      currentAddress,
      ...this.selectedMpcParticipants,
    ]);
    const threshold = Number(thresholdInput?.value || 0);
    const curve = String(curveSelect?.value || 'secp256k1').trim();
    const advancedOptions = this.readMpcCreateAdvancedOptions();

    if (!String(name || '').trim()) {
      showError('请输入 MPC 钱包名称');
      return;
    }
    if (!currentAddress) {
      showError('未找到当前账户');
      return;
    }
    if (!this.selectedMpcParticipants.length) {
      showError('请先选择联系人');
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 2) {
      showError('门限必须至少为 2');
      return;
    }
    if (threshold > participants.length) {
      showError('门限不能大于参与者数量');
      return;
    }

    const response = await this.wallet.createMpcWallet({
      name,
      participants,
      threshold,
      curve,
      password,
      ...advancedOptions
    });
    if (!response?.success) {
      throw new Error(response?.error || '创建失败');
    }

    const sessionId = response?.session?.id || response?.session?.sessionId || '-';
    if (resultEl) {
      resultEl.textContent = `密钥生成会话已创建: ${sessionId}`;
      resultEl.classList.remove('hidden');
    }

    showSuccess('密钥生成会话已创建');
    showPage('accountsPage');
    this.resetForm();
    if (this.onCreated) {
      await this.onCreated();
    }
  }

  readMpcCreateAdvancedOptions() {
    const endpoint = String(document.getElementById('mpcCreateCoordinatorEndpointInput')?.value || '').trim()
      || DEFAULT_MPC_COORDINATOR_ENDPOINT;
    try {
      new URL(endpoint);
    } catch {
      throw new Error('协调器地址格式不正确');
    }

    return { coordinatorEndpoint: endpoint };
  }
}
