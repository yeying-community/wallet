import { showSuccess, showError } from '../common/ui/index.js';
import { copyAddressToClipboard } from '../common/ui/clipboard-ui.js';
import { shortenAddress } from '../common/chain/index.js';

export class ContactsController {
  constructor({ wallet, onContactsUpdated } = {}) {
    this.wallet = wallet;
    this.onContactsUpdated = onContactsUpdated;
    this.cachedContacts = [];
    this.editingContactId = null;
  }

  bindEvents() {
    const closeBtn = document.getElementById('closeContactEditorModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeEditorModal());
    }
    const modal = document.getElementById('contactEditorModal');
    const overlay = modal?.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => this.closeEditorModal());
    }

    const addBtn = document.getElementById('addContactBtn');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        await this.handleAddContact();
      });
    }

    const cancelBtn = document.getElementById('cancelEditContactBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeEditorModal());
    }

    const openAddBtn = document.getElementById('openAddContactBtn');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => {
        this.openEditorModal();
      });
    }

    const menuBtn = document.getElementById('contactsMenuBtn');
    const menu = document.getElementById('contactsMenu');
    if (menuBtn && menu) {
      menuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleContactsMenu();
      });

      menu.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'import') {
          const input = document.getElementById('contactsImportInput');
          input?.click();
        }
        if (action === 'export') {
          await this.handleExportContacts();
        }
        this.closeContactsMenu();
      });

      document.addEventListener('click', (event) => {
        if (menu.classList.contains('hidden')) return;
        const target = event.target;
        if (menu.contains(target) || menuBtn.contains(target)) {
          return;
        }
        this.closeContactsMenu();
      });
    }

    const importInput = document.getElementById('contactsImportInput');
    if (importInput) {
      importInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) {
          await this.handleImportContacts(file);
        }
        event.target.value = '';
      });
    }

    const list = document.getElementById('contactsList');
    if (list) {
      list.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (target) {
          const action = target.dataset.action;
          if (action === 'copy') {
            const address = target.dataset.address;
            await copyAddressToClipboard(address, (message) => {
              if (/失败/.test(message)) {
                showError(message);
              } else {
                showSuccess(message);
              }
            });
          }
          if (action === 'delete') {
            const contactId = target.dataset.id;
            await this.handleDeleteContact(contactId);
          }
          return;
        }

        const item = event.target.closest('.contact-item');
        if (item?.dataset?.id) {
          if (event.target.closest('.contact-actions')) {
            return;
          }
          this.handleEditContact(item.dataset.id);
        }
      });
    }

    const contactMenuBtn = document.getElementById('contactSelectorBtn');
    const contactMenu = document.getElementById('contactMenu');
    if (contactMenuBtn && contactMenu) {
      contactMenuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleContactMenu();
      });

      document.addEventListener('click', (event) => {
        if (!contactMenu || !contactMenuBtn) return;
        if (contactMenu.classList.contains('hidden')) return;
        const target = event.target;
        if (contactMenu.contains(target) || contactMenuBtn.contains(target)) {
          return;
        }
        this.closeContactMenu();
      });
    }
  }

  async loadContacts() {
    try {
      const contacts = await this.wallet.getContacts();
      this.cachedContacts = contacts || [];
      this.renderContacts(contacts);
      this.renderContactSelect(contacts);
      this.onContactsUpdated?.(contacts);
    } catch (error) {
      console.error('[ContactsController] 加载联系人失败:', error);
      this.cachedContacts = [];
      this.renderContacts([]);
      this.renderContactSelect([]);
    }
  }

  async handleAddContact() {
    const nameInput = document.getElementById('contactNameInput');
    const addressInput = document.getElementById('contactAddressInput');
    const noteInput = document.getElementById('contactNoteInput');

    const name = nameInput?.value.trim() || '';
    const address = addressInput?.value.trim() || '';
    const note = noteInput?.value.trim() || '';

    if (!name) {
      showError('请输入联系人名称');
      return;
    }
    if (!address) {
      showError('请输入联系人地址');
      return;
    }

    try {
      if (this.editingContactId) {
        await this.wallet.updateContact({ id: this.editingContactId, name, address, note });
        showSuccess('联系人已更新');
      } else {
        await this.wallet.addContact({ name, address, note });
        showSuccess('联系人已添加');
      }
      this.closeEditorModal();
      await this.loadContacts();
    } catch (error) {
      console.error('[ContactsController] 添加联系人失败:', error);
      showError(error.message || '添加失败');
    }
  }

  closeEditorModal() {
    const modal = document.getElementById('contactEditorModal');
    modal?.classList.add('hidden');
    this.clearEditMode();
  }

  handleEditContact(contactId) {
    const contact = this.cachedContacts.find(item => item?.id === contactId);
    if (!contact) return;
    const nameInput = document.getElementById('contactNameInput');
    const addressInput = document.getElementById('contactAddressInput');
    const noteInput = document.getElementById('contactNoteInput');
    const idInput = document.getElementById('contactIdInput');
    if (nameInput) nameInput.value = contact.name || '';
    if (addressInput) addressInput.value = contact.address || '';
    if (noteInput) noteInput.value = contact.note || '';
    if (idInput) idInput.value = contact.id || '';
    this.editingContactId = contact.id || null;
    const addBtn = document.getElementById('addContactBtn');
    if (addBtn) addBtn.textContent = '保存修改';
    const titleEl = document.getElementById('contactModalTitle');
    if (titleEl) titleEl.textContent = '编辑联系人';
    this.openEditorModal(false);
  }

  clearEditMode() {
    const nameInput = document.getElementById('contactNameInput');
    const addressInput = document.getElementById('contactAddressInput');
    const noteInput = document.getElementById('contactNoteInput');
    const idInput = document.getElementById('contactIdInput');
    if (nameInput) nameInput.value = '';
    if (addressInput) addressInput.value = '';
    if (noteInput) noteInput.value = '';
    if (idInput) idInput.value = '';
    this.editingContactId = null;
    const addBtn = document.getElementById('addContactBtn');
    if (addBtn) addBtn.textContent = '添加联系人';
    const titleEl = document.getElementById('contactModalTitle');
    if (titleEl) titleEl.textContent = '添加联系人';
  }

  openEditorModal(reset = true) {
    if (reset) {
      this.clearEditMode();
    }
    const modal = document.getElementById('contactEditorModal');
    modal?.classList.remove('hidden');
    const nameInput = document.getElementById('contactNameInput');
    nameInput?.focus();
  }

  async handleDeleteContact(contactId) {
    if (!contactId) return;
    if (!confirm('确定要删除该联系人吗？')) {
      return;
    }
    try {
      await this.wallet.deleteContact(contactId);
      showSuccess('联系人已删除');
      await this.loadContacts();
    } catch (error) {
      console.error('[ContactsController] 删除联系人失败:', error);
      showError(error.message || '删除失败');
    }
  }

  async handleExportContacts() {
    try {
      const contacts = await this.wallet.getContacts();
      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        contacts: contacts || []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yeying-contacts-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccess('联系人已导出');
    } catch (error) {
      console.error('[ContactsController] 导出失败:', error);
      showError('导出失败: ' + error.message);
    }
  }

  async handleImportContacts(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const contacts = this.normalizeImportedContacts(data);
      if (!contacts.length) {
        showError('未找到有效联系人数据');
        return;
      }

      const existing = await this.wallet.getContacts();
      const existingMap = new Map(
        (existing || []).map(item => [String(item.address || '').toLowerCase(), item])
      );

      let added = 0;
      let updated = 0;
      let failed = 0;

      for (const item of contacts) {
        const name = String(item.name || '').trim();
        const address = String(item.address || '').trim();
        const note = String(item.note || '').trim();
        if (!name || !address) {
          failed += 1;
          continue;
        }
        const key = address.toLowerCase();
        try {
          const existingContact = existingMap.get(key);
          if (existingContact) {
            await this.wallet.updateContact({
              id: existingContact.id,
              name: name || existingContact.name,
              address,
              note: note || existingContact.note || ''
            });
            updated += 1;
          } else {
            await this.wallet.addContact({ name, address, note });
            added += 1;
          }
        } catch (error) {
          failed += 1;
        }
      }

      await this.loadContacts();
      showSuccess(`导入完成：新增 ${added}，更新 ${updated}，失败 ${failed}`);
    } catch (error) {
      console.error('[ContactsController] 导入失败:', error);
      showError('导入失败: ' + error.message);
    }
  }

  normalizeImportedContacts(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;

    if (Array.isArray(data.contacts)) return data.contacts;
    if (data.contacts && typeof data.contacts === 'object') {
      return Object.values(data.contacts);
    }

    if (data.data?.contacts) {
      if (Array.isArray(data.data.contacts)) return data.data.contacts;
      if (typeof data.data.contacts === 'object') {
        return Object.values(data.data.contacts);
      }
    }

    if (typeof data === 'object') {
      const values = Object.values(data);
      if (values.some(item => item && item.address)) {
        return values;
      }
    }

    return [];
  }

  renderContacts(contacts) {
    const list = document.getElementById('contactsList');
    if (!list) return;

    if (!contacts || contacts.length === 0) {
      list.innerHTML = '<div class="empty-message">暂无联系人</div>';
      return;
    }

    list.innerHTML = contacts.map(contact => `
      <div class="contact-item" data-id="${contact.id}">
        <div class="contact-info">
          <div class="contact-name">${contact.name || '-'}</div>
          <div class="contact-address">${contact.address ? shortenAddress(contact.address) : '-'}</div>
          ${contact.note ? `<div class="contact-note">${contact.note}</div>` : ''}
        </div>
        <div class="contact-actions">
          <button class="btn btn-icon contact-action-btn" data-action="copy" data-address="${contact.address}" aria-label="复制地址" title="复制">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="btn btn-icon contact-action-btn danger" data-action="delete" data-id="${contact.id}" aria-label="删除联系人" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  renderContactSelect(contacts) {
    const menu = document.getElementById('contactMenu');
    const trigger = document.getElementById('contactSelectorBtn');
    if (!menu || !trigger) return;
    const recipientInput = document.getElementById('recipientAddress');

    if (!contacts || contacts.length === 0) {
      menu.innerHTML = '<button type="button" class="network-option" disabled>暂无联系人</button>';
      return;
    }

    menu.innerHTML = contacts.map(contact => {
      const address = contact.address || '';
      const short = address ? shortenAddress(address) : '';
      const label = contact.name ? `${contact.name}${short ? ` (${short})` : ''}` : short || address;
      return `<button type="button" class="network-option" data-address="${address}">${label}</button>`;
    }).join('');

    menu.querySelectorAll('.network-option').forEach(btn => {
      const address = btn.dataset.address;
      if (!address) return;
      btn.addEventListener('click', () => {
        if (recipientInput) {
          recipientInput.value = address;
        }
        this.closeContactMenu();
      });
    });
  }

  toggleContactMenu() {
    const menu = document.getElementById('contactMenu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) {
      this.openContactMenu();
    } else {
      this.closeContactMenu();
    }
  }

  toggleContactsMenu() {
    const menu = document.getElementById('contactsMenu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) {
      this.openContactsMenu();
    } else {
      this.closeContactsMenu();
    }
  }

  openContactsMenu() {
    const menu = document.getElementById('contactsMenu');
    const trigger = document.getElementById('contactsMenuBtn');
    if (!menu || !trigger) return;
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }

  closeContactsMenu() {
    const menu = document.getElementById('contactsMenu');
    const trigger = document.getElementById('contactsMenuBtn');
    if (!menu || !trigger) return;
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }

  openContactMenu() {
    const menu = document.getElementById('contactMenu');
    const trigger = document.getElementById('contactSelectorBtn');
    if (!menu || !trigger) return;
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }

  closeContactMenu() {
    const menu = document.getElementById('contactMenu');
    const trigger = document.getElementById('contactSelectorBtn');
    if (!menu || !trigger) return;
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }
}
