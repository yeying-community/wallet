import { showError, showSuccess, showWaiting, hideWaiting } from '../../common/ui/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const ENDPOINT_STORAGE_KEY = 'passportNodeEndpoint';
const BINDING_STORAGE_PREFIX = 'passportIdentityBinding:';
const EMAIL_VERIFICATION_STORAGE_PREFIX = 'passportEmailVerification:';
const BINDING_STATE_PENDING_EMAIL = 'pending-email';
const BINDING_STATE_COMPLETE = 'complete';

export class PassportSettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    document.getElementById('passportIdentityBtn')?.addEventListener('click', () => this.handleIdentityAction());
    document.getElementById('passportUnlinkBtn')?.addEventListener('click', () => this.loginAndUnlink());
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

  loadBindingState(endpoint, address) {
    try {
      const raw = String(globalThis.localStorage?.getItem(this.bindingStorageKey(endpoint, address)) || '').trim();
      if (raw === '1' || raw === BINDING_STATE_COMPLETE) return BINDING_STATE_COMPLETE;
      if (raw === BINDING_STATE_PENDING_EMAIL) return BINDING_STATE_PENDING_EMAIL;
      return '';
    } catch { return ''; }
  }

  persistBindingState(endpoint, address, state) {
    try {
      const key = this.bindingStorageKey(endpoint, address);
      if (state) globalThis.localStorage?.setItem(key, state === true ? BINDING_STATE_COMPLETE : String(state));
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  emailVerificationStorageKey(endpoint, address) {
    return `${EMAIL_VERIFICATION_STORAGE_PREFIX}${endpoint}:${String(address || '').toLowerCase()}`;
  }

  persistEmailVerificationState(endpoint, address, state) {
    try {
      const key = this.emailVerificationStorageKey(endpoint, address);
      if (state) globalThis.localStorage?.setItem(key, JSON.stringify(state));
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  loadEmailVerificationState(endpoint, address) {
    try {
      const raw = globalThis.localStorage?.getItem(this.emailVerificationStorageKey(endpoint, address));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async renderBindingAction() {
    const button = document.getElementById('passportIdentityBtn');
    if (!button) return;
    const unlinkButton = document.getElementById('passportUnlinkBtn');
    let state = '';
    let account = null;
    try {
      account = await this.wallet.getCurrentAccount();
      state = this.loadBindingState(this.endpoint(), account?.address);
    } catch { state = ''; }
    const pending = state === BINDING_STATE_PENDING_EMAIL;
    const complete = state === BINDING_STATE_COMPLETE;
    button.dataset.state = state || 'none';
    button.textContent = complete ? '变更社区邮箱' : (pending ? '继续完成绑定' : '绑定社区身份');
    button.classList.toggle('btn-primary', true);
    button.classList.toggle('btn-danger', false);
    unlinkButton?.classList.toggle('hidden', !complete && !pending);
    if (complete) {
      this.setStatus(`夜莺社区身份已绑定，绑定钱包：${this.formatWalletAddress(account?.address)}。可变更社区邮箱；如此前未完成邮箱验证，请解绑后重新绑定。`);
    } else if (pending) {
      this.setStatus(`已完成钱包绑定但邮箱尚未确认，请继续完成绑定。绑定钱包：${this.formatWalletAddress(account?.address)}`);
    } else {
      this.setStatus('');
    }
  }

  async handleIdentityAction() {
    const state = document.getElementById('passportIdentityBtn')?.dataset.state || 'none';
    if (state === BINDING_STATE_COMPLETE) return this.changePassportEmail();
    if (state === BINDING_STATE_PENDING_EMAIL) return this.continueEmailVerification();
    return this.loginAndBind();
  }

  setStatus(text) {
    const element = document.getElementById('passportStatusText');
    if (element) element.textContent = text;
  }

  setEmailStatus(text) {
    const element = document.getElementById('passportEmailStatusText');
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
      const email = this.promptEmail();
      if (!email) return;
      const auth = await this.authenticateWithCurrentWallet();
      if (!auth) return;
      const { endpoint, account, accessToken } = auth;
      const result = await this.wallet.createPassportBinding(endpoint, accessToken);
      if (!result?.success || !result.binding?.subjectId) throw new Error(result?.error || 'Passport 绑定失败');
      this.persistBindingState(endpoint, account.address, BINDING_STATE_PENDING_EMAIL);
      const completed = await this.sendAndConfirmEmail(auth, email);
      await this.renderBindingAction();
      if (completed) showSuccess('社区身份已绑定');
    } catch (error) {
      this.setStatus(`绑定未完成：${error.message || '未知错误'}`);
      showError(error.message || '社区身份绑定未完成');
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

  async authenticateWithCurrentWallet() {
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
    if (!password) return null;
    showWaiting();
    const signature = await this.transaction.signMessage(challenge, password);
    const session = await this.verify(endpoint, account.address, signature);
    const accessToken = String(session?.token || '').trim();
    if (!accessToken) throw new Error('Node 未返回短期会话');
    return { endpoint, account, accessToken, password };
  }

  promptEmail(defaultValue = '') {
    const value = globalThis.prompt?.('请输入社区邮箱', defaultValue) ?? null;
    if (value === null) return '';
    const email = String(value || '').trim().toLowerCase();
    if (!email) throw new Error('请输入社区邮箱');
    return email;
  }

  promptVerificationCode() {
    const value = globalThis.prompt?.('请输入邮件中的 6 位验证码') ?? null;
    if (value === null) return '';
    const code = String(value || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码');
    return code;
  }

  async sendEmailVerification(auth, email) {
    const result = await this.wallet.requestPassportEmailVerification(auth.endpoint, auth.accessToken, email);
    if (!result?.success || !result.verification?.verificationId) throw new Error(result?.error || '验证码发送失败');
    this.persistEmailVerificationState(auth.endpoint, auth.account.address, {
      verificationId: result.verification.verificationId,
      email,
      emailHint: result.verification.emailHint || '',
      expiresAt: result.verification.expiresAt || ''
    });
    this.setEmailStatus(`验证码已发送至 ${result.verification.emailHint || email}，请查收邮件后输入 6 位验证码。`);
    return result.verification;
  }

  async sendAndConfirmEmail(auth, email) {
    await this.sendEmailVerification(auth, email);
    hideWaiting();
    const code = this.promptVerificationCode();
    if (!code) {
      this.setStatus('验证码已发送，请稍后继续完成社区身份绑定。');
      return false;
    }
    showWaiting();
    return await this.confirmEmailVerificationWithAuth(auth, code);
  }

  async confirmEmailVerificationWithAuth(auth, code) {
    const state = this.loadEmailVerificationState(auth.endpoint, auth.account.address);
    const verificationId = String(state?.verificationId || '').trim();
    if (!verificationId) throw new Error('请重新发送邮箱验证码');
    const result = await this.wallet.confirmPassportEmailVerification(auth.endpoint, auth.accessToken, verificationId, code);
    if (!result?.success || !result.verification?.email) throw new Error(result?.error || '邮箱确认失败');
    this.persistBindingState(auth.endpoint, auth.account.address, BINDING_STATE_COMPLETE);
    this.persistEmailVerificationState(auth.endpoint, auth.account.address, null);
    this.setEmailStatus(`社区邮箱已验证：${result.verification.email}`);
    return true;
  }

  async continueEmailVerification() {
    try {
      const email = this.promptEmail();
      if (!email) return;
      const auth = await this.authenticateWithCurrentWallet();
      if (!auth) return;
      const completed = await this.sendAndConfirmEmail(auth, email);
      await this.renderBindingAction();
      if (completed) showSuccess('社区身份已绑定');
    } catch (error) {
      this.setEmailStatus(`绑定未完成：${error.message || '未知错误'}`);
      showError(error.message || '社区身份绑定未完成');
    } finally { hideWaiting(); }
  }

  async changePassportEmail() {
    try {
      const email = this.promptEmail();
      if (!email) return;
      const auth = await this.authenticateWithCurrentWallet();
      if (!auth) return;
      const completed = await this.sendAndConfirmEmail(auth, email);
      await this.renderBindingAction();
      if (completed) showSuccess('社区邮箱已更新');
    } catch (error) {
      this.setEmailStatus(`邮箱变更失败：${error.message || '未知错误'}`);
      showError(error.message || '邮箱变更失败');
    } finally { hideWaiting(); }
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
      this.persistEmailVerificationState(endpoint, account.address, null);
      await this.renderBindingAction();
      showSuccess('社区身份已解绑');
    } catch (error) {
      showError(error.message || '社区身份解绑失败');
    } finally { hideWaiting(); }
  }

  formatWalletAddress(address) {
    const value = String(address || '').trim();
    if (value.length <= 12) return value || '-';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
}
