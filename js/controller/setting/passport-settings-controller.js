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
    button.textContent = complete ? '变更验证资料' : (pending ? '继续验证' : '验证');
    button.classList.toggle('btn-primary', true);
    button.classList.toggle('btn-danger', false);
    unlinkButton?.classList.toggle('hidden', !complete && !pending);
    if (complete) {
      this.setStatus(`当前钱包已完成验证，钱包：${this.formatWalletAddress(account?.address)}。可变更验证用户名和邮箱；如需重新建立验证，请移除验证服务关联后再验证。`);
    } else if (pending) {
      this.setStatus(`钱包控制权已确认，但邮箱尚未验证。请继续验证，钱包：${this.formatWalletAddress(account?.address)}`);
    } else {
      this.setStatus('');
    }
  }

  async handleIdentityAction() {
    const state = document.getElementById('passportIdentityBtn')?.dataset.state || 'none';
    if (state === BINDING_STATE_COMPLETE) return this.changePassportIdentity();
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
      if (!result?.success || !result.status?.enabled) throw new Error(result?.error || '身份验证服务不可用');
      this.setStatus('服务可用，等待验证');
      if (!quiet) showSuccess('身份验证服务可用');
    } catch (error) {
      this.setStatus(`服务不可用：${error.message || '未知错误'}`);
      if (!quiet) showError(error.message || '身份验证服务不可用');
    }
  }

  async loginAndBind() {
    try {
      const username = this.promptUsername();
      if (!username) return;
      const email = this.promptEmail();
      if (!email) return;
      const completed = await this.requestAndConfirmIdentity({ username, email });
      await this.renderBindingAction();
      if (completed) showSuccess('钱包验证已完成');
    } catch (error) {
      this.setStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
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
    const value = globalThis.prompt?.('请输入验证邮箱', defaultValue) ?? null;
    if (value === null) return '';
    const email = String(value || '').trim().toLowerCase();
    if (!email) throw new Error('请输入验证邮箱');
    return email;
  }

  promptUsername(defaultValue = '') {
    const value = globalThis.prompt?.('请输入验证用户名（3-32 位小写字母、数字、点、下划线或连字符）', defaultValue) ?? null;
    if (value === null) return '';
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
    return username;
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
      this.setStatus('验证码已发送，请稍后继续验证。');
      return false;
    }
    showWaiting();
    return await this.confirmEmailVerificationWithAuth(auth, code);
  }

  async requestAndConfirmIdentity({ username, email }) {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('请输入 Node 服务地址');
    this.persistEndpoint(endpoint);
    const account = await this.wallet.getCurrentAccount();
    if (!account?.address) throw new Error('未找到当前账户');
    const identities = await this.wallet.listIdentities();
    const identityId = identities?.selectedIdentityId;
    const identityDocument = await this.wallet.exportIdentityDocument(identityId);
    if (!identityDocument?.document?.id && !identityDocument?.id) throw new Error('未选择钱包身份');
    const identity = identityDocument.document || identityDocument;
    const identityDid = identity.id;
    const password = await this.requestPassword?.();
    if (!password) return false;
    showWaiting();
    const chainKey = account.chainKey || `eip155:${account.chainId || 1}`;
    const linkChallenge = await this.fetchIdentityLinkChallenge(endpoint, identityDid, { chainKey, address: account.address });
    const accountSignature = await this.transaction.signMessage(linkChallenge.message, password);
    const linkResult = await this.verifyIdentityLink(endpoint, {
      identityDocument: identity,
      identity: identityDid,
      account: { chainKey, address: account.address },
      nonce: linkChallenge.nonce,
      issuedAt: linkChallenge.issuedAt,
      expiresAt: linkChallenge.expiresAt,
      accountSignature
    });
    if (!linkResult?.verifiedAt) throw new Error('钱包账户关联失败');
    const requested = await this.wallet.requestIdentityVerification(endpoint, {
      types: ['email', 'username'],
      identity: identityDid,
      account: { chainKey, address: account.address },
      email,
      username
    });
    if (!requested?.verificationId) throw new Error('Node 未返回验证事务 ID');
    this.persistBindingState(endpoint, account.address, BINDING_STATE_PENDING_EMAIL);
    this.persistEmailVerificationState(endpoint, account.address, { verificationId: requested.verificationId, email, username, expiresAt: requested.expiresAt || '' });
    this.setEmailStatus(`验证码已发送至 ${requested.email || email}，请查收邮件后输入 6 位验证码。`);
    hideWaiting();
    const code = this.promptVerificationCode();
    if (!code) {
      this.setStatus('验证码已发送，请稍后继续验证。');
      return false;
    }
    showWaiting();
    const result = await this.wallet.confirmIdentityVerification(endpoint, requested.verificationId, code, ['email', 'username']);
    if (!Array.isArray(result?.credentials) || result.credentials.length < 2) throw new Error('Node 未返回完整身份凭证');
    this.persistBindingState(endpoint, account.address, BINDING_STATE_COMPLETE);
    this.persistEmailVerificationState(endpoint, account.address, null);
    this.setEmailStatus(`已验证邮箱：${email}`);
    return true;
  }

  async fetchIdentityLinkChallenge(endpoint, identity, account) {
    const response = await fetch(new URL('/api/v1/public/identity/account-links/challenge', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, account })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0 || !json.data?.message) throw new Error(json.message || '获取钱包身份关联 challenge 失败');
    return json.data;
  }

  async verifyIdentityLink(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/account-links/verify', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '钱包身份关联失败');
    return json.data;
  }

  async confirmEmailVerificationWithAuth(auth, code) {
    const state = this.loadEmailVerificationState(auth.endpoint, auth.account.address);
    const verificationId = String(state?.verificationId || '').trim();
    if (!verificationId) throw new Error('请重新发送邮箱验证码');
    const result = await this.wallet.confirmPassportEmailVerification(auth.endpoint, auth.accessToken, verificationId, code);
    if (!result?.success || !result.verification?.email) throw new Error(result?.error || '邮箱确认失败');
    this.persistBindingState(auth.endpoint, auth.account.address, BINDING_STATE_COMPLETE);
    this.persistEmailVerificationState(auth.endpoint, auth.account.address, null);
    this.setEmailStatus(`验证邮箱已确认：${result.verification.email}`);
    return true;
  }

  async continueEmailVerification() {
    try {
      const email = this.promptEmail();
      if (!email) return;
      const state = this.loadEmailVerificationState(this.endpoint(), (await this.wallet.getCurrentAccount())?.address);
      const completed = await this.requestAndConfirmIdentity({ username: state?.username || this.promptUsername(), email });
      await this.renderBindingAction();
      if (completed) showSuccess('钱包验证已完成');
    } catch (error) {
      this.setEmailStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
    } finally { hideWaiting(); }
  }

  async changePassportIdentity() {
    try {
      const username = this.promptUsername();
      if (!username) return;
      const email = this.promptEmail();
      if (!email) return;
      const completed = await this.requestAndConfirmIdentity({ username, email });
      await this.renderBindingAction();
      if (completed) showSuccess('验证用户名和邮箱已更新');
    } catch (error) {
      this.setEmailStatus(`邮箱变更失败：${error.message || '未知错误'}`);
      showError(error.message || '邮箱变更失败');
    } finally { hideWaiting(); }
  }

  async loginAndUnlink() {
    if (!globalThis.confirm?.('移除后，此验证服务签发的通行证和未完成授权将被撤销。确认继续？')) return;
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
      showSuccess('已移除验证服务关联');
    } catch (error) {
      showError(error.message || '移除验证服务关联失败');
    } finally { hideWaiting(); }
  }

  formatWalletAddress(address) {
    const value = String(address || '').trim();
    if (value.length <= 12) return value || '-';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
}
