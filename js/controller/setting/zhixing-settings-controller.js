/**
 * 设置页「知行图」:生成 / 导入 / 移除知行图成员密钥,查看与撤销已授权网站。
 *
 * 密钥本身只在后台(js/background/operations/zhixing.js)用钱包密码加密保存;这里只处理界面。
 */
import { showError, showSuccess } from '../../common/ui/index.js';
import { copyToClipboard } from '../../common/ui/clipboard-ui.js';

const el = (id) => document.getElementById(id);
const toggle = (id, show) => el(id)?.classList.toggle('hidden', !show);

const ERRORS = {
  ZHIXING_BAD_MNEMONIC: '助记词无效:请检查词数、拼写和顺序',
  ZHIXING_KEY_EXISTS: '钱包里已经有一把知行图密钥;如需更换请先移除',
  ZHIXING_PASSWORD_REQUIRED: '需要钱包密码'
};
function message(error) {
  const m = String(error?.message || error || '');
  for (const [code, text] of Object.entries(ERRORS)) if (m.includes(code)) return text;
  return m || '操作失败';
}

export class ZhixingSettingsController {
  constructor({ wallet, requestPassword }) {
    this.wallet = wallet;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    el('zhixingImportBtn')?.addEventListener('click', () => {
      toggle('zhixingImportForm', true);
      toggle('zhixingNewMnemonic', false);
    });
    el('zhixingImportConfirmBtn')?.addEventListener('click', () => this.handleImport());
    el('zhixingCreateBtn')?.addEventListener('click', () => this.handleCreate());
    el('zhixingNewMnemonicDoneBtn')?.addEventListener('click', () => {
      el('zhixingNewMnemonicWords').textContent = '';
      toggle('zhixingNewMnemonic', false);
      this.load();
    });
    el('zhixingCopyBtn')?.addEventListener('click', async () => {
      await copyToClipboard(el('zhixingAddress')?.textContent || '');
      showSuccess('已复制公钥');
    });
    el('zhixingRemoveBtn')?.addEventListener('click', () => this.handleRemove());
  }

  async load() {
    try {
      const key = await this.wallet.getZhixingKey();
      toggle('zhixingKeyNone', !key);
      toggle('zhixingKeyPresent', !!key);
      if (!key) return;
      el('zhixingAddress').textContent = key.address;
      await this.renderSites();
    } catch (error) {
      console.warn('[Zhixing] load failed:', error);
    }
  }

  async renderSites() {
    const box = el('zhixingSites');
    if (!box) return;
    box.textContent = '';
    const sites = await this.wallet.listZhixingSites();
    if (!sites.length) {
      box.textContent = '无';
      return;
    }
    for (const site of sites) {
      const row = document.createElement('div');
      row.className = 'settings-row';
      const name = document.createElement('span');
      name.textContent = site.origin;
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-small';
      btn.type = 'button';
      btn.textContent = '撤销';
      btn.addEventListener('click', async () => {
        await this.wallet.revokeZhixingSite(site.origin);
        await this.renderSites();
      });
      row.append(name, btn);
      box.appendChild(row);
    }
  }

  async handleImport() {
    const mnemonic = el('zhixingMnemonic')?.value || '';
    const passphrase = el('zhixingPassphrase')?.value || '';
    if (!mnemonic.trim()) return showError('请输入助记词');
    const password = await this.requestPassword?.();
    if (!password) return;
    try {
      await this.wallet.importZhixingKey(mnemonic, passphrase, password);
      el('zhixingMnemonic').value = '';
      el('zhixingPassphrase').value = '';
      toggle('zhixingImportForm', false);
      showSuccess('已导入知行图密钥');
      await this.load();
    } catch (error) {
      showError(message(error));
    }
  }

  async handleCreate() {
    const password = await this.requestPassword?.();
    if (!password) return;
    try {
      const result = await this.wallet.createZhixingKey(password);
      toggle('zhixingImportForm', false);
      el('zhixingNewMnemonicWords').textContent = result.mnemonic;
      toggle('zhixingNewMnemonic', true);
    } catch (error) {
      showError(message(error));
    }
  }

  async handleRemove() {
    if (!confirm('从钱包移除知行图密钥?没有助记词就再也找不回这个知行图账户。')) return;
    const password = await this.requestPassword?.();
    if (!password) return;
    try {
      await this.wallet.removeZhixingKey(password);
      showSuccess('已移除');
      await this.load();
    } catch (error) {
      showError(message(error));
    }
  }
}
