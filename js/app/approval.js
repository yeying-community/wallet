/**
 * 授权页面入口
 */

import { ApprovalController } from '../controller/approval-controller.js';
import { WalletDomain } from '../domain/wallet-domain.js';
import { TransactionDomain } from '../domain/transaction-domain.js';
import { NetworkDomain } from '../domain/network-domain.js';
import { TokenDomain } from '../domain/token-domain.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { showToast } from '../common/ui/index.js';
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
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
  }

  async init() {
    try {
      // 解析URL参数
      const urlParams = new URLSearchParams(window.location.search);
      this.requestId = urlParams.get('requestId');
      this.requestType = this.normalizeRequestType(urlParams.get('type'));

      if (!this.requestId || !this.requestType) {
        showToast('无效的请求参数', 'error');
        setTimeout(() => window.close(), 2000);
        return;
      }

      // 从background获取请求详情
      const response = await chrome.runtime.sendMessage({
        type: ApprovalMessageType.GET_PENDING_REQUEST,
        data: { requestId: this.requestId }
      });

      if (!response || !response.request) {
        showToast('无法获取请求详情', 'error');
        setTimeout(() => window.close(), 2000);
        return;
      }

      this.requestData = response.request?.data || response.request;

      // 根据类型显示对应界面
      this.renderRequestUI();

      // 初始化控制器
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

  renderRequestUI() {
    switch (this.requestType) {
      case 'connect':
        this.renderConnectRequest();
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
      wrapper.appendChild(this.buildStatementNode(payloadInfo.payload, 0));
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

  isWideStatementKey(key) {
    const normalized = String(key || '').toLowerCase();
    return normalized === 'resource' || normalized === 'action';
  }

  formatStatementScalar(key, value) {
    if (!key) return null;
    const normalizedKey = String(key).toLowerCase();
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

    recapInfo.capabilities.forEach((entry) => {
      const resourceBox = document.createElement('div');
      resourceBox.className = 'recap-resource';

      const title = document.createElement('div');
      title.className = 'recap-resource-title';
      title.textContent = entry.resource;
      resourceBox.appendChild(title);

      const actionList = document.createElement('div');
      actionList.className = 'recap-action-list';

      entry.actions.forEach((actionEntry) => {
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
        actionList.appendChild(row);
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
    setText('siweIssuedAt', siweInfo.issuedAt, 'siweIssuedAtRow');
    setText('siweExpiration', siweInfo.expirationTime, 'siweExpirationRow');
    setText('siweNotBefore', siweInfo.notBefore, 'siweNotBeforeRow');
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
