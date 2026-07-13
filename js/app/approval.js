/**
 * 授权页面入口
 */

import { ApprovalController } from '../controller/approval-controller.js';
import { WalletDomain } from '../domain/wallet-domain.js';
import { TransactionDomain } from '../domain/transaction-domain.js';
import { NetworkDomain } from '../domain/network-domain.js';
import { TokenDomain } from '../domain/token-domain.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { hideToast, hideWaiting, showToast } from '../common/ui/index.js';
import {
  APPROVAL_PORT_NAME,
  ApprovalMessageType,
  ApprovalPortMessageType
} from '../protocol/extension-protocol.js';
class ApprovalApp {
  constructor() {
    this.wallet = new WalletDomain();
    this.transaction = new TransactionDomain();
    this.network = new NetworkDomain();
    this.token = new TokenDomain({ network: this.network });
    this.controller = null;
    this.requestId = null;
    this.requestType = null;
    this.requestData = null;
    this.approvalPort = null;
    this.approvalReconnectTimer = null;
    this.unloading = false;
    this.beforeUnloadListener = null;
  }

  async init() {
    try {
      // 解析URL参数
      const urlParams = new URLSearchParams(window.location.search);
      this.requestId = urlParams.get('requestId');
      this.requestType = this.normalizeRequestType(urlParams.get('type'));

      await this.loadAndRenderRequest({
        requestId: this.requestId,
        requestType: this.requestType
      });
      this.connectApprovalChannel();
      
    } catch (error) {
      console.error('初始化失败:', error);
      showToast('初始化失败: ' + error.message, 'error');
      setTimeout(() => window.close(), 2000);
    }
  }

  normalizeRequestType(type) {
    if (!type) return type;
    if (type === 'sign_message' || type === 'sign_typed_data') {
      return 'sign';
    }
    if (type === 'sign_transaction') {
      return 'transaction';
    }
    return type;
  }

  connectApprovalChannel() {
    if (this.approvalPort || this.unloading) return;
    if (this.approvalReconnectTimer) {
      clearTimeout(this.approvalReconnectTimer);
      this.approvalReconnectTimer = null;
    }

    const port = chrome.runtime.connect({ name: APPROVAL_PORT_NAME });
    this.approvalPort = port;
    port.onMessage.addListener((message) => {
      if (message?.type !== ApprovalPortMessageType.ACTIVATE_REQUEST) return;
      const requestType = this.normalizeRequestType(message.requestType);
      this.loadAndRenderRequest({ requestId: message.requestId, requestType })
        .then(() => {
          port.postMessage({
            type: ApprovalPortMessageType.ACTIVATE_RESULT,
            transitionId: message.transitionId,
            success: true
          });
        })
        .catch((error) => {
          console.error('切换审批请求失败:', error);
          port.postMessage({
            type: ApprovalPortMessageType.ACTIVATE_RESULT,
            transitionId: message.transitionId,
            success: false,
            error: error?.message || String(error)
          });
        });
    });
    port.onDisconnect.addListener(() => {
      if (this.approvalPort === port) this.approvalPort = null;
      if (!this.unloading) {
        this.approvalReconnectTimer = setTimeout(() => {
          this.approvalReconnectTimer = null;
          this.connectApprovalChannel();
        }, 250);
      }
    });
    port.postMessage({ type: ApprovalPortMessageType.READY });

    this.beforeUnloadListener = () => {
      this.unloading = true;
      this.controller?.dispose?.();
      if (this.approvalReconnectTimer) {
        clearTimeout(this.approvalReconnectTimer);
        this.approvalReconnectTimer = null;
      }
      try { port.disconnect(); } catch (error) { /* page is unloading */ }
      this.approvalPort = null;
    };
    window.addEventListener('beforeunload', this.beforeUnloadListener, { once: true });
  }

  async loadAndRenderRequest({ requestId, requestType }) {
    if (!requestType || (requestType !== 'unlock' && !requestId)) {
      throw new Error('无效的请求参数');
    }

    let requestData;
    if (requestType === 'unlock') {
      const walletState = await this.wallet.getWalletState();
      requestData = {
        ...(walletState?.lastUnlockRequest || {}),
        unlocked: Boolean(walletState?.unlocked)
      };
    } else {
      const response = await chrome.runtime.sendMessage({
        type: ApprovalMessageType.GET_PENDING_REQUEST,
        data: { requestId }
      });

      if (!response || !response.request) {
        throw new Error('无法获取请求详情');
      }

      requestData = response.request?.data || response.request;
    }

    this.controller?.dispose?.();
    this.controller = null;
    this.requestId = requestId;
    this.requestType = requestType;
    this.requestData = requestData;

    this.resetRequestUI();
    this.renderRequestUI();

    this.controller = new ApprovalController({
      wallet: this.wallet,
      transaction: this.transaction,
      network: this.network,
      token: this.token,
      requestId: this.requestId,
      requestType: this.requestType,
      requestData: this.requestData
    });

    this.controller.bindEvents();
    this.syncRequestUrl();
  }

  syncRequestUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('type', this.requestType);
    if (this.requestId) url.searchParams.set('requestId', this.requestId);
    history.replaceState(null, '', url.toString());
  }

  resetRequestUI() {
    hideToast();
    hideWaiting();
    document.querySelectorAll('.request-view').forEach((view) => {
      view.classList.add('hidden');
    });
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = false;
    });
    document.querySelectorAll('input').forEach((input) => {
      input.disabled = false;
      input.value = '';
    });

    const connectHint = document.getElementById('connectFlowHint');
    if (connectHint) {
      connectHint.textContent = '';
      connectHint.classList.add('hidden');
    }

    const txDataRow = document.getElementById('txDataRow');
    if (txDataRow) {
      txDataRow.style.display = 'none';
    }

    const signTitle = document.querySelector('#signRequest h2');
    if (signTitle) {
      signTitle.textContent = '签名请求';
    }

    const signMessage = document.getElementById('signMessage');
    if (signMessage) {
      signMessage.textContent = '';
      delete signMessage.dataset.rendered;
    }

    const signMessageSection = document.getElementById('signMessageSection');
    if (signMessageSection) {
      signMessageSection.classList.remove('hidden');
    }

    [
      'siweSection',
      'recapSection',
      'siweWarnings'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    [
      'siweStatementRow',
      'siweUriRow',
      'siweVersionRow',
      'siweChainIdRow',
      'siweNonceRow',
      'siweIssuedAtRow',
      'siweExpirationRow',
      'siweNotBeforeRow',
      'siweRequestIdRow',
      'siweResourcesRow',
      'recapStatementRow'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('hidden');
        el.style.display = 'none';
      }
    });

    [
      'siweDomain',
      'siweAddress',
      'siweStatement',
      'siweUri',
      'siweVersion',
      'siweChainId',
      'siweNonce',
      'siweIssuedAt',
      'siweExpiration',
      'siweNotBefore',
      'siweRequestId',
      'siweResources',
      'siweWarningList',
      'siweRaw',
      'recapDomain',
      'recapAddress',
      'recapStatement',
      'recapList',
      'recapRaw'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
  }

  renderRequestUI() {
    switch (this.requestType) {
      case 'connect':
        this.renderConnectRequest();
        break;
      case 'profile':
        this.renderProfileRequest();
        break;
      case 'unlock':
        this.renderUnlockRequest();
        break;
      case 'transaction':
        this.renderTransactionRequest();
        break;
      case 'sign':
        this.renderSignRequest();
        break;
      case 'addChain':
        this.renderAddChainRequest();
        break;
      case 'watchAsset':
        this.renderWatchAssetRequest();
        break;
      default:
        showToast('未知的请求类型: ' + this.requestType, 'error');
        setTimeout(() => window.close(), 2000);
    }
  }

  renderConnectRequest() {
    document.getElementById('connectRequest').classList.remove('hidden');
    document.getElementById('connectOrigin').textContent = this.requestData.origin;
  }

  renderProfileRequest() {
    document.getElementById('profileRequest').classList.remove('hidden');
    document.getElementById('profileOrigin').textContent = this.requestData.origin || '未知网站';
    const labels = { username: '公开用户名', email: '邮箱地址' };
    const list = document.getElementById('profileFieldList');
    list.innerHTML = '';
    (this.requestData.fields || []).forEach((field) => {
      const item = document.createElement('div');
      item.className = 'permission-item';
      item.textContent = labels[field] || field;
      list.appendChild(item);
    });
  }

  renderUnlockRequest() {
    document.getElementById('unlockRequest').classList.remove('hidden');
    const originEl = document.getElementById('unlockOrigin');
    if (originEl) {
      originEl.textContent = this.requestData.origin || '会话已过期，请输入密码继续';
    }
  }

  renderTransactionRequest() {
    document.getElementById('transactionRequest').classList.remove('hidden');
    document.getElementById('txOrigin').textContent = this.requestData.origin;

    const tx = this.requestData.transaction;
    document.getElementById('txTo').textContent = tx.to || '合约创建';
    document.getElementById('txValue').textContent =
      ethers.formatEther(tx.value || '0') + ' ETH';
    document.getElementById('txGasLimit').textContent = tx.gasLimit || '自动';
    document.getElementById('txGasPrice').textContent =
      tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') + ' Gwei' : '自动';

    if (tx.data && tx.data !== '0x') {
      document.getElementById('txDataRow').style.display = 'flex';
      document.getElementById('txData').textContent =
        tx.data.substring(0, 20) + '...';
    }
  }

  renderSignRequest() {
    document.getElementById('signRequest').classList.remove('hidden');
    document.getElementById('signOrigin').textContent = this.requestData.origin;

    let message = this.requestData.message;

    // 处理TypedData签名
    if (this.requestData.typedData) {
      try {
        message = JSON.stringify(this.requestData.typedData, null, 2);
      } catch (e) {
        message = String(this.requestData.typedData);
      }
    }
    // 处理普通签名
    else if (message && message.startsWith('0x')) {
      try {
        message = ethers.toUtf8String(message);
      } catch (e) {
        // 保持原样
      }
    }

    const siweInfo = this.parseSiweMessage(message);
    const titleEl = document.querySelector('#signRequest h2');
    if (titleEl) {
      titleEl.textContent = siweInfo ? '登录请求' : '签名请求';
    }
    if (siweInfo) {
      this.renderSiweRequest(siweInfo, message);
    }

    const recapInfo = this.parseRecapFromSiwe(message, siweInfo);
    if (recapInfo && recapInfo.capabilities.length > 0) {
      this.renderRecapRequest(recapInfo, message);
    }

    if (!siweInfo && (!recapInfo || recapInfo.capabilities.length === 0)) {
      const messageEl = document.getElementById('signMessage');
      messageEl.textContent = message;
      messageEl.dataset.rendered = 'true';
    }
  }

  parseRecapFromSiwe(message, siweInfo) {
    const siwe = siweInfo || this.parseSiweMessage(message);
    if (!siwe) return null;
    if (!siwe.resources.length) return null;

    const recapList = siwe.resources
      .map((uri) => this.parseRecapResource(uri))
      .filter((item) => item);

    if (!recapList.length) return null;

    const recap = this.mergeRecap(recapList);
    const capabilities = this.flattenRecapCapabilities(recap);
    return { ...siwe, recap, capabilities };
  }

  parseSiweMessage(message) {
    if (!message || typeof message !== 'string') return null;
    const firstLineMatch = message.match(
      /^(.*) wants you to sign in with your Ethereum account:\s*$/im
    );
    if (!firstLineMatch) return null;

    const lines = message.split(/\r?\n/);
    const domain = firstLineMatch[1]?.trim() || '';

    let address = '';
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        address = line;
        break;
      }
    }

    const resources = this.extractSiweResources(lines);
    const statement = this.extractSiweStatement(lines);
    const fields = this.extractSiweFields(lines);

    return {
      domain,
      address,
      statement,
      uri: fields.uri,
      version: fields.version,
      chainId: fields.chainId,
      nonce: fields.nonce,
      issuedAt: fields.issuedAt,
      expirationTime: fields.expirationTime,
      notBefore: fields.notBefore,
      requestId: fields.requestId,
      resources,
    };
  }

  extractSiweResources(lines) {
    const resources = [];
    const index = lines.findIndex((line) => line.trim() === 'Resources:');
    if (index === -1) return resources;
    for (let i = index + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('- ')) break;
      resources.push(line.slice(2).trim());
    }
    return resources;
  }

  extractSiweFields(lines) {
    const fields = {
      uri: '',
      version: '',
      chainId: '',
      nonce: '',
      issuedAt: '',
      expirationTime: '',
      notBefore: '',
      requestId: '',
    };
    const keyMap = [
      { label: 'URI', key: 'uri' },
      { label: 'Version', key: 'version' },
      { label: 'Chain ID', key: 'chainId' },
      { label: 'Nonce', key: 'nonce' },
      { label: 'Issued At', key: 'issuedAt' },
      { label: 'Expiration Time', key: 'expirationTime' },
      { label: 'Not Before', key: 'notBefore' },
      { label: 'Request ID', key: 'requestId' },
    ];

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      keyMap.forEach((entry) => {
        const prefix = `${entry.label}:`;
        if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
          fields[entry.key] = line.slice(prefix.length).trim();
        }
      });
    });

    return fields;
  }

  extractSiweStatement(lines) {
    const addressIndex = lines.findIndex((line) =>
      line.toLowerCase().includes('wants you to sign in with your ethereum account')
    );
    if (addressIndex === -1) return '';
    let cursor = addressIndex + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') {
      cursor++;
    }
    // skip address line
    cursor++;
    while (cursor < lines.length && lines[cursor].trim() === '') {
      cursor++;
    }

    const statementLines = [];
    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (line.trim() === '') break;
      if (/^[A-Za-z].*:\s/.test(line)) break;
      statementLines.push(line);
    }
    return statementLines.join('\n').trim();
  }

  parseRecapResource(uri) {
    if (!uri || typeof uri !== 'string') return null;
    if (!uri.startsWith('urn:recap:')) return null;
    const encoded = uri.slice('urn:recap:'.length);
    try {
      const json = this.decodeBase64Url(encoded);
      const recap = JSON.parse(json);
      if (!recap || typeof recap !== 'object') return null;
      return recap;
    } catch (error) {
      return null;
    }
  }

  decodeBase64Url(input) {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    return atob(base64);
  }

  mergeRecap(recaps) {
    const merged = { att: {} };
    recaps.forEach((recap) => {
      const att = recap?.att;
      if (!att || typeof att !== 'object') return;
      Object.keys(att).forEach((resource) => {
        if (!merged.att[resource]) {
          merged.att[resource] = {};
        }
        const actions = att[resource] || {};
        Object.keys(actions).forEach((action) => {
          const raw = actions[action];
          const constraints = Array.isArray(raw)
            ? raw
            : raw
            ? [raw]
            : [];
          if (!merged.att[resource][action]) {
            merged.att[resource][action] = [];
          }
          merged.att[resource][action].push(...constraints);
        });
      });
    });
    return merged;
  }

  flattenRecapCapabilities(recap) {
    const items = [];
    const att = recap?.att || {};
    Object.keys(att).forEach((resource) => {
      const actions = att[resource] || {};
      const actionList = Object.keys(actions).map((action) => ({
        action,
        constraints: actions[action] || [],
      }));
      items.push({ resource, actions: actionList });
    });
    return items;
  }

  formatConstraints(constraints) {
    if (!constraints) return '无约束';
    const list = Array.isArray(constraints) ? constraints : [constraints];
    const normalized = list
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') {
          const keys = Object.keys(item);
          if (!keys.length) return '';
          try {
            return JSON.stringify(item);
          } catch (error) {
            return String(item);
          }
        }
        return String(item);
      })
      .filter((item) => item);
    return normalized.length ? normalized.join('; ') : '无约束';
  }

  renderStatementValue(container, statement) {
    if (!container) return;
    container.textContent = '';
    const payloadInfo = this.extractStatementPayload(statement);
    if (payloadInfo) {
      const wrapper = document.createElement('div');
      wrapper.className = 'statement-structured';
      if (payloadInfo.prefix) {
        const prefixEl = document.createElement('div');
        prefixEl.className = 'statement-prefix';
        prefixEl.textContent = payloadInfo.prefix;
        wrapper.appendChild(prefixEl);
      }
      if (this.isUcanRootPayload(payloadInfo.payload)) {
        wrapper.appendChild(this.buildUcanRootSummary(payloadInfo.payload));
      } else {
        wrapper.appendChild(this.buildStatementNode(payloadInfo.payload, 0));
      }
      container.appendChild(wrapper);
      return;
    }
    const textEl = document.createElement('div');
    textEl.className = 'statement-text';
    textEl.textContent = statement;
    container.appendChild(textEl);
  }

  extractStatementPayload(statement) {
    if (!statement || typeof statement !== 'string') return null;
    const trimmed = statement.trim();
    if (!trimmed) return null;
    const direct = this.tryParseStatementJson(trimmed);
    if (direct) {
      return { prefix: '', payload: direct };
    }
    const objectMatch = this.extractJsonWithPrefix(trimmed, '{', '}');
    if (objectMatch) return objectMatch;
    const arrayMatch = this.extractJsonWithPrefix(trimmed, '[', ']');
    if (arrayMatch) return arrayMatch;
    return null;
  }

  extractJsonWithPrefix(text, open, close) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start === -1 || end === -1 || end <= start) return null;
    const prefix = text.slice(0, start).trim();
    const jsonPart = text.slice(start, end + 1);
    const parsed = this.tryParseStatementJson(jsonPart);
    if (!parsed) return null;
    return { prefix, payload: parsed };
  }

  tryParseStatementJson(statement) {
    if (!statement || typeof statement !== 'string') return null;
    const trimmed = statement.trim();
    if (!trimmed) return null;
    const looksLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (!looksLikeJson) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      return null;
    }
    return null;
  }

  isUcanRootPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const audience = this.normalizeSummaryText(payload.aud || payload.audience);
    const caps = this.getRootCapabilities(payload);
    return audience && caps.length > 0;
  }

  buildUcanRootSummary(payload) {
    const card = document.createElement('div');
    card.className = 'ucan-summary';

    const title = document.createElement('div');
    title.className = 'ucan-summary-title';
    title.textContent = '授权摘要';
    card.appendChild(title);

    const audienceRaw = this.normalizeSummaryText(payload.aud || payload.audience);
    const audience = this.formatAudience(audienceRaw) || audienceRaw;
    if (audience) {
      card.appendChild(this.buildSummaryLine('授权对象', audience));
    }

    const caps = this.getRootCapabilities(payload);
    const capabilityContext = this.buildCapabilityContext({ payload, caps });
    if (caps.length > 0) {
      card.appendChild(this.buildCapabilitySummary(caps, capabilityContext));
    }

    const exp = this.formatTimestamp(payload.exp);
    if (exp) {
      card.appendChild(this.buildSummaryLine('过期时间', exp));
    }
    const nbf = this.formatTimestamp(payload.nbf);
    if (nbf) {
      card.appendChild(this.buildSummaryLine('生效时间', nbf));
    }

    return card;
  }

  buildSummaryLine(label, value) {
    const row = document.createElement('div');
    row.className = 'ucan-summary-line';

    const key = document.createElement('div');
    key.className = 'ucan-summary-key';
    key.textContent = label;

    const val = document.createElement('div');
    val.className = 'ucan-summary-value';
    val.textContent = value;

    row.appendChild(key);
    row.appendChild(val);
    return row;
  }

  buildCapabilitySummary(caps, capabilityContext) {
    const section = document.createElement('div');
    section.className = 'ucan-summary-section';

    const label = document.createElement('div');
    label.className = 'ucan-summary-label';
    label.textContent = '能力范围';
    section.appendChild(label);

    const list = this.buildCapabilityList(caps, 0, capabilityContext);
    section.appendChild(list);
    return section;
  }

  getRootCapabilities(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    if (Array.isArray(payload.cap) && payload.cap.length > 0) {
      return payload.cap;
    }
    if (Array.isArray(payload.capabilities) && payload.capabilities.length > 0) {
      return payload.capabilities;
    }
    return [];
  }

  normalizeSummaryText(value) {
    if (value == null) return '';
    const text = String(value).trim();
    return text;
  }

  buildStatementNode(value, depth, key) {
    if (Array.isArray(value)) {
      return this.buildStatementList(value, depth, key);
    }
    if (value && typeof value === 'object') {
      return this.buildStatementTable(value, depth);
    }
    const textEl = document.createElement('div');
    textEl.className = 'statement-text';
    const formatted = this.formatStatementScalar(key, value);
    textEl.textContent = formatted ?? (value == null ? '-' : String(value));
    return textEl;
  }

  buildStatementTable(obj, depth) {
    const table = document.createElement('div');
    table.className = depth === 0 ? 'statement-table' : 'statement-table statement-table-nested';
    const entries = Object.entries(obj || {});
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'statement-text';
      empty.textContent = '(空)';
      table.appendChild(empty);
      return table;
    }
    entries.forEach(([key, value]) => {
      const row = document.createElement('div');
      row.className = 'statement-item';
      if (this.isWideStatementKey(key)) {
        row.classList.add('statement-item-wide-key');
      }

      const keyEl = document.createElement('div');
      keyEl.className = 'statement-key';
      keyEl.textContent = key;

      const valueEl = document.createElement('div');
      valueEl.className = 'statement-val';
      const formatted = this.formatStatementScalar(key, value);
      if (formatted != null) {
        valueEl.textContent = formatted;
      } else if (value && typeof value === 'object') {
        valueEl.appendChild(this.buildStatementNode(value, depth + 1, key));
      } else {
        valueEl.textContent = value == null ? '-' : String(value);
      }

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      table.appendChild(row);
    });
    return table;
  }

  buildStatementList(list, depth, key) {
    const items = Array.isArray(list) ? list : [];
    if (this.isCapabilityList(items, key)) {
      const capabilityContext = this.buildCapabilityContext({ caps: items });
      return this.buildCapabilityList(items, depth, capabilityContext);
    }
    const isPrimitiveList = items.every((item) => item == null || typeof item !== 'object');
    if (isPrimitiveList) {
      const ul = document.createElement('ul');
      ul.className = depth === 0 ? 'statement-list' : 'statement-list statement-list-nested';
      items.forEach((item) => {
        const li = document.createElement('li');
        const formatted = this.formatStatementScalar(key, item);
        li.textContent = formatted ?? (item == null ? '-' : String(item));
        ul.appendChild(li);
      });
      return ul;
    }

    const table = document.createElement('div');
    table.className = depth === 0 ? 'statement-table' : 'statement-table statement-table-nested';
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'statement-item';

      const keyEl = document.createElement('div');
      keyEl.className = 'statement-key';
      keyEl.textContent = `#${index + 1}`;

      const valueEl = document.createElement('div');
      valueEl.className = 'statement-val';
      if (item && typeof item === 'object') {
        valueEl.appendChild(this.buildStatementNode(item, depth + 1));
      } else {
        valueEl.textContent = item == null ? '-' : String(item);
      }

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      table.appendChild(row);
    });
    return table;
  }

  isCapabilityList(items, key) {
    if (!Array.isArray(items) || !items.length) return false;
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey === 'cap' || normalizedKey === 'capabilities') {
      return true;
    }
    return items.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('resource' in item || 'action' in item || 'with' in item || 'can' in item)
    );
  }

  buildCapabilityList(items, depth, capabilityContext) {
    const list = document.createElement('div');
    list.className = depth === 0 ? 'statement-cap-list' : 'statement-cap-list statement-cap-list-nested';

    items.forEach((item, index) => {
      const cap = item && typeof item === 'object' ? item : {};
      const row = document.createElement('div');
      row.className = 'statement-cap-item';

      const title = document.createElement('div');
      title.className = 'statement-cap-title';
      title.textContent = `#${index + 1}`;

      const detail = document.createElement('div');
      detail.className = 'statement-cap-detail';
      const resource = this.formatCapabilityResourceWithContext(this.getCapabilityResource(cap), capabilityContext) ?? '-';
      const action = this.formatCapabilityAction(this.getCapabilityAction(cap)) ?? '-';
      detail.textContent = `${resource}  ·  ${action}`;

      row.appendChild(title);
      row.appendChild(detail);
      const impact = this.describeCapabilityImpact(
        this.getCapabilityResource(cap),
        this.getCapabilityAction(cap),
        capabilityContext
      );
      if (impact) {
        const impactEl = document.createElement('div');
        impactEl.className = 'statement-cap-impact';
        impactEl.textContent = impact;
        row.appendChild(impactEl);
      }
      list.appendChild(row);
    });

    return list;
  }

  isWideStatementKey(key) {
    const normalized = String(key || '').toLowerCase();
    return (
      normalized === 'resource' ||
      normalized === 'action' ||
      normalized === 'with' ||
      normalized === 'can' ||
      normalized === 'aud' ||
      normalized === 'audience' ||
      normalized === 'cap' ||
      normalized === 'capabilities' ||
      normalized === 'invocationcapabilities' ||
      normalized === 'version'
    );
  }

  formatCapabilityResource(value) {
    if (value == null) return null;
    const resource = String(value).trim();
    if (!resource) return null;
    return resource;
  }

  getCapabilityResource(cap) {
    if (!cap || typeof cap !== 'object') return null;
    const withValue = this.formatCapabilityResource(cap.with);
    if (withValue) return withValue;
    return this.formatCapabilityResource(cap.resource);
  }

  getCapabilityAction(cap) {
    if (!cap || typeof cap !== 'object') return null;
    const canValue = this.normalizeCapabilityAction(cap.can);
    if (canValue) return canValue;
    const actionValue = this.normalizeCapabilityAction(cap.action);
    return actionValue || null;
  }

  formatCapabilityResourceWithContext(value, capabilityContext) {
    void capabilityContext;
    const resource = this.formatCapabilityResource(value);
    if (!resource) return resource;

    const appResource = this.parseAppResource(resource);
    if (!appResource) return resource;

    if (!appResource.scope) {
      return `app:all:${appResource.appId}`;
    }
    return `app:${appResource.scope}:${appResource.appId}`;
  }

  formatCapabilityAction(value) {
    if (value == null) return null;
    const action = String(value).trim().toLowerCase();
    if (!action) return null;
    if (action === 'invoke') {
      return 'invoke（调用）';
    }
    if (action === 'read') {
      return 'read（读取）';
    }
    if (action === 'write') {
      return 'write（写入）';
    }
    return action;
  }

  formatAudience(value) {
    if (value == null) return null;
    const audience = String(value).trim();
    if (!audience) return null;
    return audience;
  }

  normalizeCapabilityAction(value) {
    if (value == null) return '';
    return String(value).trim().toLowerCase();
  }

  sanitizeAppId(value) {
    if (value == null) return null;
    const appId = String(value).trim().replace(/[^a-zA-Z0-9._-]/g, '-');
    return appId || null;
  }

  parseAppResource(resource) {
    if (!resource || typeof resource !== 'string') return null;
    const normalized = resource.trim();
    if (!normalized.startsWith('app:')) return null;
    const suffix = normalized.slice('app:'.length).trim();
    if (!suffix) return null;

    const segments = suffix.split(':').map((segment) => segment.trim());
    if (segments.length === 1) {
      const appId = segments[0];
      if (!appId) return null;
      return { scope: null, appId };
    }

    const [scope, ...rest] = segments;
    const appId = rest.join(':').trim();
    if (!scope || !appId) return null;
    return { scope, appId };
  }

  getAppIdFromResource(resource) {
    const parsed = this.parseAppResource(resource);
    return parsed ? parsed.appId : null;
  }

  parseDidWebDomain(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    const prefix = 'did:web:';
    if (!lower.startsWith(prefix)) return null;
    const domain = text.slice(prefix.length).trim();
    return domain || null;
  }

  getRouterDomainFromResource(resource) {
    if (!resource || typeof resource !== 'string') return null;
    const normalized = resource.trim();
    const lower = normalized.toLowerCase();
    const prefix = 'llm:';
    if (lower.startsWith(prefix)) {
      const domain = normalized.slice(prefix.length).trim();
      return domain || null;
    }
    return null;
  }

  getWebdavDomainFromResource(resource) {
    if (!resource || typeof resource !== 'string') return null;
    const normalized = resource.trim();
    const lower = normalized.toLowerCase();
    if (lower.startsWith('webdav:')) {
      const domain = normalized.slice('webdav:'.length).trim();
      return domain || null;
    }
    if (lower.startsWith('dav:')) {
      const domain = normalized.slice('dav:'.length).trim();
      return domain || null;
    }
    if (lower.startsWith('app:')) {
      const suffix = normalized.slice('app:'.length).trim();
      if (this.isLikelyDomain(suffix)) {
        return suffix;
      }
    }
    return null;
  }

  isLikelyDomain(value) {
    if (value == null) return false;
    const text = String(value).trim();
    if (!text) return false;

    const hostWithPort = /^([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$/i;
    const localhostWithPort = /^localhost(:\d{1,5})?$/i;
    const ipv4WithPort = /^\d{1,3}(?:\.\d{1,3}){3}(:\d{1,5})?$/;
    const ipv6WithPort = /^\[[0-9a-f:]+\](:\d{1,5})?$/i;

    if (localhostWithPort.test(text) || ipv4WithPort.test(text) || ipv6WithPort.test(text)) {
      return true;
    }
    if (!hostWithPort.test(text)) {
      return false;
    }
    if (text.includes('.')) {
      return true;
    }
    return text.toLowerCase() === 'localhost';
  }

  getRequestOriginDomain() {
    const origin = this.requestData && this.requestData.origin ? String(this.requestData.origin).trim() : '';
    if (!origin) return null;
    try {
      return new URL(origin).host || null;
    } catch {
      return null;
    }
  }

  getRequestOriginAppId() {
    const domain = this.getRequestOriginDomain();
    if (!domain) return null;
    return this.sanitizeAppId(domain);
  }

  normalizeServiceHost(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (raw.includes('://')) {
      try {
        const host = new URL(raw).host.trim();
        return host || null;
      } catch {
        return null;
      }
    }
    const host = raw.split('/')[0].trim();
    return host || null;
  }

  extractServiceHosts(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { router: null, webdav: null, byKey: {}, list: [] };
    }
    const serviceHostsRaw =
      payload.service_hosts && typeof payload.service_hosts === 'object' && !Array.isArray(payload.service_hosts)
        ? payload.service_hosts
        : null;
    if (!serviceHostsRaw) {
      return { router: null, webdav: null, byKey: {}, list: [] };
    }

    const byKey = {};
    const list = [];
    Object.entries(serviceHostsRaw).forEach(([rawKey, rawValue]) => {
      const key = String(rawKey || '').trim().toLowerCase();
      const host = this.normalizeServiceHost(rawValue);
      if (!key || !host) return;
      byKey[key] = host;
      if (!list.includes(host)) {
        list.push(host);
      }
    });

    return {
      router: byKey.router || null,
      webdav: byKey.webdav || byKey.dav || byKey.storage || null,
      byKey,
      list,
    };
  }

  buildCapabilityContext(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const payload =
      opts.payload && typeof opts.payload === 'object' && !Array.isArray(opts.payload)
        ? opts.payload
        : null;
    const caps = Array.isArray(opts.caps) ? opts.caps : [];
    const context = {
      currentAppId: null,
      routerAppId: null,
      webdavAppId: null,
      routerServiceHost: null,
      webdavServiceHost: null,
      serviceHostsByKey: {},
      serviceHostList: [],
    };

    const serviceHosts = this.extractServiceHosts(payload);
    if (serviceHosts.router) {
      context.routerServiceHost = serviceHosts.router;
    }
    if (serviceHosts.webdav) {
      context.webdavServiceHost = serviceHosts.webdav;
    }
    if (serviceHosts.byKey && typeof serviceHosts.byKey === 'object') {
      context.serviceHostsByKey = serviceHosts.byKey;
    }
    if (Array.isArray(serviceHosts.list)) {
      context.serviceHostList = serviceHosts.list;
    }

    caps.forEach((item) => {
      const cap = item && typeof item === 'object' ? item : {};
      const resource = this.getCapabilityResource(cap);
      const action = this.getCapabilityAction(cap);
      if (!resource) return;
      const appId = this.getAppIdFromResource(resource);

      if (appId) {
        if (!context.webdavAppId && (action === 'write' || action === 'read')) {
          context.webdavAppId = appId;
        }
        if (!context.routerAppId && action === 'invoke') {
          context.routerAppId = appId;
        }
        return;
      }

      if (!context.routerServiceHost) {
        const routerDomain = this.getRouterDomainFromResource(resource);
        if (routerDomain) {
          context.routerServiceHost = routerDomain;
        }
      }
      if (!context.webdavServiceHost) {
        const webdavDomain = this.getWebdavDomainFromResource(resource);
        if (webdavDomain) {
          context.webdavServiceHost = webdavDomain;
        }
      }
      if (this.isRouterCapabilityResource(resource)) {
        if (!context.routerAppId) {
          context.routerAppId = this.getRequestOriginAppId();
        }
      }
    });

    if (payload) {
      const audDomain = this.parseDidWebDomain(payload.aud || payload.audience);
      const audAppId = this.sanitizeAppId(audDomain);
      if (audAppId) {
        if (!context.currentAppId) {
          context.currentAppId = audAppId;
        }
        if (!context.routerAppId) {
          context.routerAppId = audAppId;
        }
        if (!context.webdavAppId) {
          context.webdavAppId = audAppId;
        }
      }
    }

    const originAppId = this.getRequestOriginAppId();
    if (!context.currentAppId && originAppId) {
      context.currentAppId = originAppId;
    }
    if (!context.webdavAppId && originAppId) {
      context.webdavAppId = originAppId;
    }
    if (!context.routerAppId && originAppId) {
      context.routerAppId = originAppId;
    }
    if (!context.currentAppId) {
      context.currentAppId = context.webdavAppId || context.routerAppId || null;
    }

    return context;
  }

  isRouterCapabilityResource(resource) {
    if (!resource || typeof resource !== 'string') return false;
    const normalized = resource.trim().toLowerCase();
    return (
      normalized.startsWith('llm:') ||
      normalized === 'router:llm' ||
      normalized === 'router/llm' ||
      normalized === 'llm' ||
      normalized === 'profile'
    );
  }

  resolveCapabilityServiceHost(resource, action, context) {
    const hostByScope = this.getServiceHostFromResourceScope(resource, context);
    if (hostByScope) {
      return hostByScope;
    }

    const normalizedAction = this.normalizeCapabilityAction(action);
    if (normalizedAction === 'invoke') {
      return (
        context.routerServiceHost ||
        this.pickServiceHostByAction(normalizedAction, context) ||
        null
      );
    }
    if (normalizedAction === 'write' || normalizedAction === 'read') {
      return (
        context.webdavServiceHost ||
        this.pickServiceHostByAction(normalizedAction, context) ||
        null
      );
    }

    const normalizedResource = this.formatCapabilityResource(resource);
    if (normalizedResource) {
      const routerDomain = this.getRouterDomainFromResource(normalizedResource);
      if (routerDomain) return routerDomain;
      const webdavDomain = this.getWebdavDomainFromResource(normalizedResource);
      if (webdavDomain) return webdavDomain;
    }

    return (
      this.pickServiceHostByAction(normalizedAction, context) ||
      context.routerServiceHost ||
      context.webdavServiceHost ||
      null
    );
  }

  getServiceHostFromResourceScope(resource, context) {
    const parsed = this.parseAppResource(resource);
    if (!parsed || !parsed.scope) return null;

    const scope = String(parsed.scope).trim().toLowerCase();
    if (!scope || scope === 'all') return null;

    const byKey =
      context && context.serviceHostsByKey && typeof context.serviceHostsByKey === 'object'
        ? context.serviceHostsByKey
        : {};

    if (byKey[scope]) {
      return byKey[scope];
    }

    if ((scope === 'webdav' || scope === 'dav' || scope === 'storage') && byKey.webdav) {
      return byKey.webdav;
    }
    if ((scope === 'router' || scope === 'llm') && byKey.router) {
      return byKey.router;
    }

    return null;
  }

  formatServiceHostList(hosts) {
    const list = Array.isArray(hosts) ? hosts.filter((item) => item && typeof item === 'string') : [];
    if (!list.length) return null;
    if (list.length <= 3) {
      return list.join(', ');
    }
    return `${list.slice(0, 3).join(', ')} 等${list.length}个服务`;
  }

  pickServiceHostByAction(action, context) {
    const normalizedAction = this.normalizeCapabilityAction(action);
    const byKey =
      context && context.serviceHostsByKey && typeof context.serviceHostsByKey === 'object'
        ? context.serviceHostsByKey
        : {};
    const hostList = Array.isArray(context && context.serviceHostList) ? context.serviceHostList : [];

    const invokePriority = ['router', 'node', 'go', 'java', 'python', 'api', 'backend', 'service'];
    const storagePriority = ['webdav', 'dav', 'storage', 'file', 'files'];
    const preferredKeys =
      normalizedAction === 'invoke'
        ? invokePriority
        : normalizedAction === 'write' || normalizedAction === 'read'
          ? storagePriority
          : [];

    const matchedHosts = [];
    for (const key of preferredKeys) {
      const host = byKey[key];
      if (!host) continue;
      if (!matchedHosts.includes(host)) {
        matchedHosts.push(host);
      }
    }
    if (matchedHosts.length === 1) {
      return matchedHosts[0];
    }
    if (matchedHosts.length > 1) {
      return this.formatServiceHostList(matchedHosts);
    }

    return this.formatServiceHostList(hostList);
  }

  resolveCapabilityTargetResource(resource, action, context) {
    const appId = this.getAppIdFromResource(resource);
    if (appId) {
      const normalized = this.formatCapabilityResourceWithContext(resource, context);
      return normalized || `app:all:${appId}`;
    }

    const normalizedAction = this.normalizeCapabilityAction(action);
    if (normalizedAction === 'invoke' && context.routerAppId) {
      return `app:all:${context.routerAppId}`;
    }
    if ((normalizedAction === 'write' || normalizedAction === 'read') && context.webdavAppId) {
      return `app:all:${context.webdavAppId}`;
    }
    if (this.isRouterCapabilityResource(resource) && context.routerAppId) {
      return `app:all:${context.routerAppId}`;
    }
    return this.formatCapabilityResource(resource) || '<目标资源>';
  }

  describeCapabilityImpact(resourceValue, actionValue, capabilityContext) {
    const resource = this.formatCapabilityResource(resourceValue);
    const action = this.normalizeCapabilityAction(actionValue);
    if (!resource || !action) return null;
    const context = capabilityContext && typeof capabilityContext === 'object' ? capabilityContext : {};
    const currentAppId =
      context.currentAppId || context.webdavAppId || context.routerAppId || '<当前 appId>';
    const targetResource = this.resolveCapabilityTargetResource(resource, action, context);
    const serviceHost = this.resolveCapabilityServiceHost(resource, action, context);
    const serviceLabel = serviceHost || '<未声明服务地址>';
    const actionLabel = this.formatCapabilityAction(action) || action;
    return `授权当前应用 app:${currentAppId} 访问资源: ${targetResource}，访问服务: ${serviceLabel}，执行${actionLabel}操作。`;
  }

  formatStatementScalar(key, value) {
    if (!key) return null;
    const normalizedKey = String(key).toLowerCase();
    if (normalizedKey === 'resource') {
      return this.formatCapabilityResource(value);
    }
    if (normalizedKey === 'action') {
      return this.formatCapabilityAction(value);
    }
    if (normalizedKey === 'with') {
      return this.formatCapabilityResource(value);
    }
    if (normalizedKey === 'can') {
      return this.formatCapabilityAction(value);
    }
    if (normalizedKey === 'aud') {
      return this.formatAudience(value);
    }
    if (normalizedKey === 'audience') {
      return this.formatAudience(value);
    }
    const timeKeys = new Set([
      'exp',
      'iat',
      'nbf',
      'issuedat',
      'expirationtime',
      'notbefore',
      'expires',
      'expiresat',
    ]);
    if (!timeKeys.has(normalizedKey)) return null;
    return this.formatTimestamp(value);
  }

  formatTimestamp(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      return this.formatDate(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d{10,13}$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return null;
        return this.formatDate(this.normalizeEpoch(num));
      }
      const date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) {
        return this.formatDate(date);
      }
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return this.formatDate(this.normalizeEpoch(value));
    }
    return null;
  }

  normalizeEpoch(value) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  renderRecapRequest(recapInfo, rawMessage) {
    const recapSection = document.getElementById('recapSection');
    const messageSection = document.getElementById('signMessageSection');
    const messageEl = document.getElementById('signMessage');
    if (messageSection) {
      messageSection.classList.add('hidden');
    }
    if (recapSection) {
      recapSection.classList.remove('hidden');
    }
    if (messageEl) {
      messageEl.textContent = rawMessage;
      messageEl.dataset.rendered = 'true';
    }

    const domainEl = document.getElementById('recapDomain');
    const addressEl = document.getElementById('recapAddress');
    const statementEl = document.getElementById('recapStatement');
    const statementRow = document.getElementById('recapStatementRow');
    const rawEl = document.getElementById('recapRaw');

    if (domainEl) {
      domainEl.textContent = recapInfo.domain || this.requestData.origin || '-';
    }
    if (addressEl) {
      addressEl.textContent = recapInfo.address || '-';
    }
    if (statementEl && statementRow) {
      if (recapInfo.statement) {
        this.renderStatementValue(statementEl, recapInfo.statement);
        statementRow.style.display = 'flex';
      } else {
        statementRow.style.display = 'none';
      }
    }
    if (rawEl) {
      rawEl.textContent = rawMessage;
    }

    const listEl = document.getElementById('recapList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const recapCaps = recapInfo.capabilities.flatMap((entry) =>
      (entry.actions || []).map((actionEntry) => ({
        resource: entry.resource,
        action: actionEntry?.action,
      }))
    );
    const recapCapabilityContext = this.buildCapabilityContext({ caps: recapCaps });

    recapInfo.capabilities.forEach((entry) => {
      const resourceBox = document.createElement('div');
      resourceBox.className = 'recap-resource';

      const title = document.createElement('div');
      title.className = 'recap-resource-title';
      title.textContent =
        this.formatCapabilityResourceWithContext(entry.resource, recapCapabilityContext) ||
        entry.resource;
      resourceBox.appendChild(title);

      const actionList = document.createElement('div');
      actionList.className = 'recap-action-list';

      entry.actions.forEach((actionEntry) => {
        const actionItem = document.createElement('div');
        actionItem.className = 'recap-action-item';

        const row = document.createElement('div');
        row.className = 'recap-action';

        const actionName = document.createElement('span');
        actionName.className = 'recap-action-name';
        actionName.textContent = actionEntry.action;

        const constraints = document.createElement('span');
        constraints.className = 'recap-constraints';
        constraints.textContent = this.formatConstraints(actionEntry.constraints);

        row.appendChild(actionName);
        row.appendChild(constraints);
        actionItem.appendChild(row);
        const impact = this.describeCapabilityImpact(
          entry.resource,
          actionEntry.action,
          recapCapabilityContext
        );
        if (impact) {
          const impactEl = document.createElement('div');
          impactEl.className = 'recap-capability-impact';
          impactEl.textContent = impact;
          actionItem.appendChild(impactEl);
        }
        actionList.appendChild(actionItem);
      });

      resourceBox.appendChild(actionList);
      listEl.appendChild(resourceBox);
    });
  }

  renderSiweRequest(siweInfo, rawMessage) {
    const siweSection = document.getElementById('siweSection');
    const messageSection = document.getElementById('signMessageSection');
    if (messageSection) {
      messageSection.classList.add('hidden');
    }
    if (siweSection) {
      siweSection.classList.remove('hidden');
    }

    const setText = (id, value, rowId) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value || '-';
      }
      if (rowId) {
        const row = document.getElementById(rowId);
        if (row) {
          row.style.display = value ? 'flex' : 'none';
        }
      }
    };

    setText('siweDomain', siweInfo.domain);
    setText('siweAddress', siweInfo.address);
    setText('siweUri', siweInfo.uri, 'siweUriRow');
    setText('siweVersion', siweInfo.version, 'siweVersionRow');
    setText('siweChainId', siweInfo.chainId, 'siweChainIdRow');
    setText('siweNonce', siweInfo.nonce, 'siweNonceRow');
    setText('siweIssuedAt', this.formatSiweTime(siweInfo.issuedAt), 'siweIssuedAtRow');
    setText('siweExpiration', this.formatSiweTime(siweInfo.expirationTime), 'siweExpirationRow');
    setText('siweNotBefore', this.formatSiweTime(siweInfo.notBefore), 'siweNotBeforeRow');
    setText('siweRequestId', siweInfo.requestId, 'siweRequestIdRow');

    const statementRow = document.getElementById('siweStatementRow');
    const statementEl = document.getElementById('siweStatement');
    if (statementRow && statementEl) {
      if (siweInfo.statement) {
        this.renderStatementValue(statementEl, siweInfo.statement);
        statementRow.style.display = 'flex';
      } else {
        statementRow.style.display = 'none';
      }
    }

    let resourcesValue = '';
    if (siweInfo.resources && siweInfo.resources.length > 0) {
      if (siweInfo.resources.length <= 3) {
        resourcesValue = siweInfo.resources.join(', ');
      } else {
        resourcesValue = `${siweInfo.resources.length} items`;
      }
    }
    setText('siweResources', resourcesValue, 'siweResourcesRow');

    const rawEl = document.getElementById('siweRaw');
    if (rawEl) {
      rawEl.textContent = rawMessage;
    }

    this.renderSiweWarnings(siweInfo);
  }

  renderSiweWarnings(siweInfo) {
    const container = document.getElementById('siweWarnings');
    const listEl = document.getElementById('siweWarningList');
    if (!container || !listEl) return;
    const warnings = this.buildSiweWarnings(siweInfo);
    listEl.textContent = '';
    if (!warnings.length) {
      container.classList.add('hidden');
      return;
    }
    warnings.forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      listEl.appendChild(item);
    });
    container.classList.remove('hidden');
  }

  buildSiweWarnings(siweInfo) {
    const warnings = [];
    const origin = this.requestData?.origin || '';

    if (!siweInfo.domain) {
      warnings.push('缺少域名信息');
    } else if (origin && !this.isDomainMatch(origin, siweInfo.domain)) {
      warnings.push(`域名与当前站点不一致: ${siweInfo.domain}`);
    }

    if (!siweInfo.address) {
      warnings.push('缺少签名地址');
    }

    if (!siweInfo.nonce) {
      warnings.push('缺少随机数 (Nonce)');
    }

    if (!siweInfo.chainId) {
      warnings.push('缺少 Chain ID');
    }

    if (siweInfo.uri && origin) {
      const uriHost = this.safeGetHost(siweInfo.uri);
      const originHost = this.safeGetHost(origin);
      if (uriHost && originHost && uriHost !== originHost) {
        warnings.push(`URI 与当前站点不一致: ${siweInfo.uri}`);
      }
    }

    const now = Date.now();
    const issuedAt = this.safeParseDate(siweInfo.issuedAt);
    if (issuedAt && issuedAt.getTime() > now + 5 * 60 * 1000) {
      warnings.push('Issued At 在未来时间');
    }

    const expiration = this.safeParseDate(siweInfo.expirationTime);
    if (expiration && expiration.getTime() <= now) {
      warnings.push('该签名请求已过期');
    }

    const notBefore = this.safeParseDate(siweInfo.notBefore);
    if (notBefore && notBefore.getTime() > now) {
      warnings.push('该签名请求尚未生效');
    }

    return warnings;
  }

  safeGetHost(value) {
    if (!value) return '';
    try {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return new URL(value).host;
      }
      return new URL(`https://${value}`).host;
    } catch {
      return '';
    }
  }

  isDomainMatch(origin, domain) {
    const originHost = this.safeGetHost(origin);
    const domainHost = this.safeGetHost(domain);
    if (!originHost || !domainHost) return false;
    if (originHost === domainHost) return true;
    if (originHost.endsWith(`.${domainHost}`)) return true;
    if (domainHost.endsWith(`.${originHost}`)) return true;
    return false;
  }

  safeParseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  // SIWE 时间字段（issuedAt/expirationTime/notBefore）原文是 UTC ISO，
  // 展示时转为浏览器本地时区并附时区名；原始 UTC 仍可在完整消息原文中查看。
  // 解析失败则原样返回，避免吞掉异常格式。
  formatSiweTime(value) {
    const date = this.safeParseDate(value);
    if (!date) return value || '';
    try {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      });
    } catch {
      return value || '';
    }
  }

  renderAddChainRequest() {
    document.getElementById('addChainRequest').classList.remove('hidden');
    document.getElementById('addChainOrigin').textContent = this.requestData.origin;

    const chain = this.requestData.chainConfig;

    document.getElementById('chainName').textContent = chain.chainName || '未知';
    document.getElementById('chainId').textContent = chain.chainId || '未知';
    document.getElementById('chainRpcUrl').textContent =
      Array.isArray(chain.rpcUrls) ? chain.rpcUrls[0] : chain.rpcUrls || '未知';

    // 可选字段
    if (chain.nativeCurrency?.symbol) {
      document.getElementById('chainSymbol').textContent = chain.nativeCurrency.symbol;
      document.getElementById('chainSymbolRow').style.display = 'flex';
    }

    if (chain.blockExplorerUrls && chain.blockExplorerUrls[0]) {
      document.getElementById('chainExplorer').textContent = chain.blockExplorerUrls[0];
      document.getElementById('chainExplorerRow').style.display = 'flex';
    }
  }

  renderWatchAssetRequest() {
    document.getElementById('watchAssetRequest').classList.remove('hidden');
    document.getElementById('watchAssetOrigin').textContent = this.requestData.origin;

    const asset = this.requestData.asset || this.requestData.tokenInfo || {};

    document.getElementById('assetSymbol').textContent = asset.symbol || '未知';
    document.getElementById('assetAddress').textContent = asset.address || '未知';
    document.getElementById('assetDecimals').textContent = asset.decimals ?? '18';

    // 显示代币图标
    if (asset.image) {
      const img = document.getElementById('assetImage');
      img.src = asset.image;
      img.style.display = 'block';
      document.getElementById('assetIconPlaceholder').style.display = 'none';

      // 图片加载失败时显示占位符
      img.onerror = () => {
        img.style.display = 'none';
        document.getElementById('assetIconPlaceholder').style.display = 'flex';
      };
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new ApprovalApp();
  app.init();
});
