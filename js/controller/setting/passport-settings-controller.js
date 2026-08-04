import { showError, showSuccess, showWaiting, hideWaiting } from '../../common/ui/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const ENDPOINT_STORAGE_KEY = 'passportNodeEndpoint';
const BINDING_STORAGE_PREFIX = 'passportIdentityBinding:';

export class PassportSettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    document.getElementById('passportIdentityBtn')?.addEventListener('click', () => this.handleIdentityAction());
    document.getElementById('passportEndpointInput')?.addEventListener('change', () => this.renderBindingAction());
  }

  endpoint() { return String(document.getElementById('passportEndpointInput')?.value || '').trim(); }

  loadStoredEndpoint() {
    try { return String(globalThis.localStorage?.getItem(ENDPOINT_STORAGE_KEY) || '').trim(); } catch { return ''; }
  }

  persistEndpoint(endpoint) {
    try { globalThis.localStorage?.setItem(ENDPOINT_STORAGE_KEY, endpoint); } catch { /* storage may be unavailable */ }
  }

  bindingStorageKey(endpoint, address) {
    return `${BINDING_STORAGE_PREFIX}${endpoint}:${String(address || '').toLowerCase()}`;
  }

  persistBindingState(endpoint, address, bound) {
    try {
      const key = this.bindingStorageKey(endpoint, address);
      if (bound) globalThis.localStorage?.setItem(key, '1');
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  async renderBindingAction() {
    const button = document.getElementById('passportIdentityBtn');
    if (!button) return;
    let bound = false;
    try {
      const account = await this.wallet.getCurrentAccount();
      bound = globalThis.localStorage?.getItem(this.bindingStorageKey(this.endpoint(), account?.address)) === '1';
    } catch { bound = false; }
    button.dataset.bound = bound ? '1' : '0';
    button.textContent = bound ? '解绑社区身份' : '绑定社区身份';
    button.classList.toggle('btn-primary', !bound);
    button.classList.toggle('btn-danger', bound);
  }

  async handleIdentityAction() {
    const bound = document.getElementById('passportIdentityBtn')?.dataset.bound === '1';
    return bound ? this.loginAndUnlink() : this.loginAndBind();
  }

  setStatus(text) {
    const element = document.getElementById('passportStatusText');
    if (element) element.textContent = text;
  }

  async load() {
    const input = document.getElementById('passportEndpointInput');
    if (input && !input.value) input.value = this.loadStoredEndpoint() || DEFAULT_NODE_ENDPOINT;
    await this.renderBindingAction();
  }

  async checkStatus(quiet = false) {
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('请输入 Node 服务地址');
      this.persistEndpoint(endpoint);
      const result = await this.wallet.getPassportStatus(endpoint);
      if (!result?.success || !result.status?.enabled) throw new Error(result?.error || 'Passport 服务不可用');
      this.setStatus('服务可用，等待钱包绑定');
      if (!quiet) showSuccess('社区身份服务可用');
    } catch (error) {
      this.setStatus(`服务不可用：${error.message || '未知错误'}`);
      if (!quiet) showError(error.message || '社区身份服务不可用');
    }
  }

  async loginAndBind() {
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('请输入 Node 服务地址');
      this.persistEndpoint(endpoint);
      if (!this.transaction) throw new Error('签名模块未初始化');
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) throw new Error('未找到当前账户');
      showWaiting();
      const challenge = await this.fetchChallenge(endpoint, account.address);
      hideWaiting();
      if (!challenge) throw new Error('Node 未返回 SIWE challenge');
      const password = await this.requestPassword?.();
      if (!password) return;
      showWaiting();
      const signature = await this.transaction.signMessage(challenge, password);
      const session = await this.verify(endpoint, account.address, signature);
      const accessToken = String(session?.token || '').trim();
      if (!accessToken) throw new Error('Node 未返回短期会话');
      const result = await this.wallet.createPassportBinding(endpoint, accessToken);
      if (!result?.success || !result.binding?.subjectId) throw new Error(result?.error || 'Passport 绑定失败');
      this.persistBindingState(endpoint, account.address, true);
      await this.renderBindingAction();
      this.setStatus(`已绑定社区身份 ${result.binding.subjectId}`);
      showSuccess('社区身份已绑定');
    } catch (error) {
      this.setStatus(`绑定失败：${error.message || '未知错误'}`);
      showError(error.message || '社区身份绑定失败');
    } finally { hideWaiting(); }
  }

  async fetchChallenge(endpoint, address) {
    const url = new URL('/api/v1/public/auth/challenge', endpoint);
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '获取 SIWE challenge 失败');
    return json.data?.challenge;
  }

  async verify(endpoint, address, signature) {
    const response = await fetch(new URL('/api/v1/public/auth/verify', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || 'SIWE 校验失败');
    return json.data || {};
  }

  async loginAndUnlink() {
    if (!globalThis.confirm?.('解绑后，该社区身份下的通行证和未完成授权将被撤销。确认继续？')) return;
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('请输入 Node 服务地址');
      this.persistEndpoint(endpoint);
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) throw new Error('未找到当前账户');
      const challenge = await this.fetchChallenge(endpoint, account.address);
      const password = await this.requestPassword?.();
      if (!password) return;
      showWaiting();
      const loginSignature = await this.transaction.signMessage(challenge, password);
      const session = await this.verify(endpoint, account.address, loginSignature);
      const accessToken = String(session?.token || '').trim();
      if (!accessToken) throw new Error('Node 未返回短期会话');
      const requested = await this.wallet.createPassportUnlink(endpoint, accessToken);
      if (!requested?.success || !requested.unlink?.message) throw new Error(requested?.error || '无法创建解绑请求');
      const signature = await this.transaction.signMessage(requested.unlink.message, password);
      const confirmed = await this.wallet.confirmPassportUnlink(endpoint, accessToken, {
        requestId: requested.unlink.requestId,
        timestamp: requested.unlink.timestamp,
        signature
      });
      if (!confirmed?.success) throw new Error(confirmed?.error || '解绑失败');
      this.persistBindingState(endpoint, account.address, false);
      await this.renderBindingAction();
      showSuccess('社区身份已解绑');
    } catch (error) {
      showError(error.message || '社区身份解绑失败');
    } finally { hideWaiting(); }
  }
}
