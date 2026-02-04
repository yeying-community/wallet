/**
 * Backup & Sync Service (WebDAV)
 * Builds/merges payloads and syncs encrypted data via WebDAV.
 */

import { encryptObject, decryptObject, hashHex } from '../common/crypto/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import {
  getWallets,
  getWalletAccounts,
  saveAccount,
  updateAccount,
  saveWallet,
  getNetworks,
  getUserSetting,
  updateUserSetting,
  onStorageChanged,
  getContactList,
  saveContact,
  WalletStorageKeys,
  NetworkStorageKeys,
  ContactsStorageKeys
} from '../storage/index.js';
import { WALLET_TYPE, deriveSubAccount, getWalletMnemonic } from './vault.js';

const SYNC_PAYLOAD_VERSION = 1;
const SYNC_FILENAME = 'payload.json.enc';
const SYNC_DEBOUNCE_MS = 1500;
const DEFAULT_SYNC_ENDPOINT = 'https://webdav.yeying.pub/api';
const LEGACY_DEFAULT_APP_ID = 'yeying-wallet';
const DEFAULT_UCAN_ACTION = 'write';
const APP_SCOPE_PREFIX = 'apps';
const LEGACY_UCAN_RESOURCES = new Set([
  'profile',
  'webdav/*',
  'webdav#access',
  'webdav/access',
  'webdav'
]);
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_SYNC_JITTER_MS = 30 * 1000;
const AUTO_SYNC_MAX_BACKOFF_MS = 15 * 60 * 1000;
const MAX_ACTIVITY_LOGS = 200;

const SETTINGS_KEYS = {
  enabled: 'backupSyncEnabled',
  endpoint: 'backupSyncEndpoint',
  authMode: 'backupSyncAuthMode',
  authToken: 'backupSyncAuthToken',
  authTokenExpiresAt: 'backupSyncAuthTokenExpiresAt',
  ucanToken: 'backupSyncUcanToken',
  ucanResource: 'backupSyncUcanResource',
  ucanAction: 'backupSyncUcanAction',
  ucanAudience: 'backupSyncUcanAudience',
  basicAuth: 'backupSyncBasicAuth',
  dirty: 'backupSyncDirty',
  lastPullAt: 'backupSyncLastPullAt',
  lastPushAt: 'backupSyncLastPushAt',
  pendingDelete: 'backupSyncPendingDelete',
  networkIds: 'backupSyncNetworkIds',
  conflicts: 'backupSyncConflicts',
  remoteMeta: 'backupSyncRemoteMeta',
  logs: 'backupSyncLogs'
};

class BackupSyncService {
  constructor() {
    this._initialized = false;
    this._contexts = new Map(); // walletId => { fingerprint, syncKey }
    this._syncInFlight = false;
    this._dirty = false;
    this._debounceTimer = null;
    this._unsubscribeStorage = null;
    this._suppressStorageEvents = false;
    this._autoSyncTimer = null;
    this._autoSyncFailures = 0;
    this._remoteMeta = {};
    this._activityLogs = [];
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    this._dirty = await getUserSetting(SETTINGS_KEYS.dirty, false);
    this._remoteMeta = await getUserSetting(SETTINGS_KEYS.remoteMeta, {});
    this._activityLogs = await getUserSetting(SETTINGS_KEYS.logs, []);
    if (!Array.isArray(this._activityLogs)) {
      this._activityLogs = [];
    }
    await this._ensureDefaults();
    this._attachStorageListener();
  }

  async onUnlocked(password) {
    await this._prepareContexts(password);
    await this._handlePendingDelete();
    await this.syncAll('unlock');
    this.startAutoSync();
  }

  async onLocked() {
    try {
      await this.pushAll('lock');
    } catch (error) {
      console.warn('[BackupSync] push on lock failed:', error?.message || error);
    } finally {
      this._contexts.clear();
      this._dirty = false;
      await updateUserSetting(SETTINGS_KEYS.dirty, false).catch(() => {});
      this.stopAutoSync();
    }
  }

  markDirty(reason = 'change') {
    this._dirty = true;
    updateUserSetting(SETTINGS_KEYS.dirty, true).catch(() => {});
    this._schedulePush(reason);
  }

  async syncAll(reason = 'manual') {
    if (!(await this._isEnabled())) return;
    if (this._syncInFlight) return;
    this._syncInFlight = true;
    const startedAt = getTimestamp();
    await this._appendActivityLog(this._buildLogEntry({
      level: 'info',
      action: 'sync-start',
      reason,
      message: this._formatSyncMessage('开始', reason)
    }));

    try {
      const walletIds = Array.from(this._contexts.keys());
      for (const walletId of walletIds) {
        await this._syncWallet(walletId, reason);
      }
      await this._appendActivityLog(this._buildLogEntry({
        level: 'info',
        action: 'sync-complete',
        reason,
        message: this._formatSyncMessage('完成', reason),
        durationMs: Math.max(0, getTimestamp() - startedAt)
      }));
    } catch (error) {
      await this._appendActivityLog(this._buildLogEntry({
        level: 'error',
        action: 'sync-error',
        reason,
        message: this._formatSyncErrorMessage(reason, error)
      }));
      throw error;
    } finally {
      this._syncInFlight = false;
    }
  }

  async pushAll(reason = 'manual') {
    if (!(await this._isEnabled())) return;
    if (!this._dirty) return;

    const walletIds = Array.from(this._contexts.keys());
    for (const walletId of walletIds) {
      await this._pushWallet(walletId, reason);
    }

    this._dirty = false;
    await updateUserSetting(SETTINGS_KEYS.dirty, false).catch(() => {});
  }

  async disableSync() {
    const hasContexts = this._contexts.size > 0;
    if (hasContexts) {
      await this._deleteRemoteAll().catch(() => {});
      await updateUserSetting(SETTINGS_KEYS.pendingDelete, false).catch(() => {});
    } else {
      await updateUserSetting(SETTINGS_KEYS.pendingDelete, true).catch(() => {});
    }
    this.stopAutoSync();
  }

  async clearRemoteNow() {
    await this._deleteRemoteAll().catch(() => {});
    await this._appendActivityLog(this._buildLogEntry({
      level: 'info',
      action: 'clear-remote',
      reason: 'manual',
      message: '已清除远端备份'
    }));
  }

  async clearActivityLogs() {
    this._activityLogs = [];
    await updateUserSetting(SETTINGS_KEYS.logs, []).catch(() => {});
  }

  startAutoSync() {
    if (this._autoSyncTimer) return;
    this._autoSyncFailures = 0;
    this._scheduleAutoSync();
  }

  stopAutoSync() {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
    this._autoSyncFailures = 0;
  }

  async tryStartAutoSync() {
    if (!(await this._isEnabled())) return;
    if (this._autoSyncTimer) return;
    if (this._contexts.size === 0) {
      const password = await this._getCachedPassword();
      if (password) {
        await this._prepareContexts(password);
      }
    }
    this.startAutoSync();
  }

  _scheduleAutoSync() {
    const base = AUTO_SYNC_INTERVAL_MS;
    const backoff = Math.min(base * Math.pow(2, this._autoSyncFailures), AUTO_SYNC_MAX_BACKOFF_MS);
    const jitter = (Math.random() * 2 - 1) * AUTO_SYNC_JITTER_MS;
    const delay = Math.max(30000, backoff + jitter);
    this._autoSyncTimer = setTimeout(() => {
      this._autoSyncTimer = null;
      this._runAutoSync().catch(error => {
        console.warn('[BackupSync] auto sync failed:', error?.message || error);
      });
    }, delay);
  }

  async _runAutoSync() {
    if (!(await this._isEnabled())) {
      this.stopAutoSync();
      return;
    }

    if (this._syncInFlight) {
      this._scheduleAutoSync();
      return;
    }

    const hasAuth = await this._hasAuth();
    if (!hasAuth) {
      this._scheduleAutoSync();
      return;
    }

    const conflicts = await getUserSetting(SETTINGS_KEYS.conflicts, []);
    if (Array.isArray(conflicts) && conflicts.length > 0) {
      this._scheduleAutoSync();
      return;
    }

    if (this._contexts.size === 0) {
      const password = await this._getCachedPassword();
      if (password) {
        await this._prepareContexts(password);
      }
    }

    if (this._contexts.size === 0) {
      this._scheduleAutoSync();
      return;
    }

    try {
      if (this._dirty) {
        await this.syncAll('auto');
      } else {
        await this._pullRemoteIfChanged('auto');
      }
      this._autoSyncFailures = 0;
    } catch (error) {
      this._autoSyncFailures += 1;
      console.warn('[BackupSync] auto sync run failed:', error?.message || error);
      await this._appendActivityLog(this._buildLogEntry({
        level: 'error',
        action: 'auto-sync-error',
        reason: 'auto',
        message: this._formatSyncErrorMessage('auto', error)
      }));
    } finally {
      if (await this._isEnabled()) {
        this._scheduleAutoSync();
      } else {
        this.stopAutoSync();
      }
    }
  }

  // ==================== Internal helpers ====================

  async _prepareContexts(password) {
    const walletsMap = await getWallets();
    const wallets = Object.values(walletsMap || {});

    for (const wallet of wallets) {
      if (!wallet || wallet.type !== WALLET_TYPE.HD) continue;

      try {
        const mnemonic = await getWalletMnemonic(wallet, password);
        const fingerprint = await hashHex(`yeying-sync-id:${mnemonic}`);
        const syncKey = await hashHex(`yeying-sync-key:${mnemonic}`);

        this._contexts.set(wallet.id, { fingerprint, syncKey });
      } catch (error) {
        console.warn('[BackupSync] failed to prepare sync context:', error?.message || error);
      }
    }
  }

  async _syncWallet(walletId, reason) {
    const context = this._contexts.get(walletId);
    if (!context) return;

    const remotePayload = await this._pullRemote(context, reason).catch(() => null);
    if (remotePayload) {
      await this._applyRemotePayload(walletId, remotePayload, reason);
    }

    await this._pushWallet(walletId, reason);
  }

  async _pullRemoteIfChanged(reason) {
    const walletIds = Array.from(this._contexts.keys());
    for (const walletId of walletIds) {
      const context = this._contexts.get(walletId);
      if (!context) continue;

      const shouldPull = await this._shouldPullRemote(context);
      if (!shouldPull) continue;

      const remotePayload = await this._pullRemote(context, reason).catch(() => null);
      if (remotePayload) {
        await this._applyRemotePayload(walletId, remotePayload, reason);
      }
    }
  }

  async _shouldPullRemote(context) {
    const probe = await this._probeRemote(context).catch(() => null);
    if (!probe) return true;
    if (!probe.exists) {
      this._clearRemoteMetaEntry(context.fingerprint);
      return false;
    }
    if (probe.bypass) return true;

    const cached = this._getRemoteMetaEntry(context.fingerprint);
    if (!cached) return true;
    if (probe.etag && cached.etag && probe.etag === cached.etag) return false;
    if (!probe.etag && probe.lastModified && cached.lastModified && probe.lastModified === cached.lastModified) {
      return false;
    }
    return true;
  }

  async _pushWallet(walletId, reason) {
    const context = this._contexts.get(walletId);
    if (!context) return;

    const payload = await this._buildPayload(walletId, reason);
    if (!payload) return;

    try {
      await this._writeRemote(context, payload);
      await updateUserSetting(SETTINGS_KEYS.lastPushAt, getTimestamp()).catch(() => {});
      await this._appendActivityLog(this._buildLogEntry({
        level: 'info',
        action: 'push',
        reason,
        message: '推送远端备份'
      }));
    } catch (error) {
      await this._appendActivityLog(this._buildLogEntry({
        level: 'error',
        action: 'push-error',
        reason,
        message: this._formatSyncErrorMessage(reason, error)
      }));
      throw error;
    }
  }

  async _pullRemote(context, reason = '') {
    const primaryPath = await this._payloadPath(context.fingerprint);
    const response = await this._webdavRequest('GET', primaryPath);
    if (!response) {
      return null;
    }
    if (response.status === 404) {
      this._clearRemoteMetaEntry(context.fingerprint);
      return null;
    }

    if (!response.ok) {
      throw new Error(`WebDAV GET failed: ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;

    let ciphertext = text;
    try {
      const envelope = JSON.parse(text);
      if (envelope && typeof envelope === 'object' && envelope.ciphertext) {
        ciphertext = envelope.ciphertext;
      }
    } catch {
      // keep raw text as ciphertext
    }

    const payload = await decryptObject(ciphertext, context.syncKey);
    const etag = response.headers.get('ETag') || '';
    const lastModified = response.headers.get('Last-Modified') || '';
    if (etag || lastModified) {
      this._setRemoteMetaEntry(context.fingerprint, {
        etag: etag || undefined,
        lastModified: lastModified || undefined,
        updatedAt: getTimestamp()
      });
    }
    await updateUserSetting(SETTINGS_KEYS.lastPullAt, getTimestamp()).catch(() => {});
    await this._appendActivityLog(this._buildLogEntry({
      level: 'info',
      action: 'pull',
      reason,
      message: '拉取远端备份'
    }));
    return payload;
  }

  async _writeRemote(context, payload) {
    await this._ensureDirectory();

    const ciphertext = await encryptObject(payload, context.syncKey);
    const envelope = {
      version: SYNC_PAYLOAD_VERSION,
      cipher: 'AES-GCM',
      kdf: 'PBKDF2',
      ciphertext
    };

    const body = JSON.stringify(envelope);
    const response = await this._webdavRequest('PUT', await this._payloadPath(context.fingerprint), {
      headers: {
        'Content-Type': 'application/json'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`WebDAV PUT failed: ${response.status}`);
    }

    const etag = response.headers.get('ETag') || '';
    const lastModified = response.headers.get('Last-Modified') || '';
    if (etag || lastModified) {
      this._setRemoteMetaEntry(context.fingerprint, {
        etag: etag || undefined,
        lastModified: lastModified || undefined,
        updatedAt: getTimestamp()
      });
    }
  }

  async _buildPayload(walletId, reason) {
    const walletsMap = await getWallets();
    const wallet = walletsMap?.[walletId];
    if (!wallet || wallet.type !== WALLET_TYPE.HD) return null;

    const accounts = await getWalletAccounts(walletId);
    const accountEntries = accounts.map(account => {
      const index = Number.isFinite(account.index) ? account.index : 0;
      const nameUpdatedAt = account.nameUpdatedAt || account.updatedAt || account.createdAt || 0;
      return {
        index,
        address: account.address,
        name: account.name,
        nameUpdatedAt
      };
    });

    const networks = await getNetworks();
    const storedNetworkIds = await getUserSetting(SETTINGS_KEYS.networkIds, []);
    const networkIds = Array.from(new Set([
      ...(Array.isArray(storedNetworkIds) ? storedNetworkIds : []),
      ...(networks || [])
        .map(network => network?.chainIdHex || network?.chainId)
        .filter(Boolean)
        .map(String)
    ]));

    const contacts = await getContactList();
    const contactEntries = (contacts || []).map(contact => ({
      id: contact.id,
      name: contact.name,
      note: contact.note || '',
      address: contact.address,
      updatedAt: contact.updatedAt || contact.createdAt || 0
    }));

    return {
      version: SYNC_PAYLOAD_VERSION,
      updatedAt: getTimestamp(),
      reason,
      accountCount: wallet.accountCount || accounts.length,
      accounts: accountEntries,
      contacts: contactEntries,
      networkIds,
      networksUpdatedAt: getTimestamp()
    };
  }

  async _applyRemotePayload(walletId, remotePayload, reason) {
    if (!remotePayload || !Array.isArray(remotePayload.accounts)) return;

    const walletsMap = await getWallets();
    const wallet = walletsMap?.[walletId];
    if (!wallet || wallet.type !== WALLET_TYPE.HD) return;

    const localAccounts = await getWalletAccounts(walletId);
    const localByIndex = new Map();
    localAccounts.forEach(account => {
      const index = Number.isFinite(account.index) ? account.index : 0;
      localByIndex.set(index, account);
    });

    const remoteByIndex = new Map();
    remotePayload.accounts.forEach(account => {
      if (!account || !Number.isFinite(account.index)) return;
      remoteByIndex.set(account.index, account);
    });

    let changed = false;

    this._suppressStorageEvents = true;
    try {
      const remoteAccountCount = Number.isFinite(remotePayload.accountCount)
        ? remotePayload.accountCount
        : null;

      for (const [index, remote] of remoteByIndex.entries()) {
        const local = localByIndex.get(index);
        const remoteUpdatedAt = remote.nameUpdatedAt || remote.updatedAt || remote.createdAt || 0;

        if (local) {
          if (remote.address && local.address && remote.address.toLowerCase() !== local.address.toLowerCase()) {
            continue;
          }

          const localUpdatedAt = local.nameUpdatedAt || local.updatedAt || local.createdAt || 0;
          if (remoteUpdatedAt > localUpdatedAt && remote.name && remote.name !== local.name) {
            await updateAccount({
              ...local,
              name: remote.name,
              nameUpdatedAt: remoteUpdatedAt
            });
            changed = true;
          } else if (remoteUpdatedAt === localUpdatedAt && remote.name && remote.name !== local.name) {
            await this._recordConflict({
              id: `account:${walletId}:${index}`,
              type: 'account',
              accountId: local.id,
              walletId,
              index,
              localName: local.name || '',
              remoteName: remote.name || '',
              timestamp: remoteUpdatedAt
            });
          }
        } else {
          // missing account, try to derive
          const password = await this._getCachedPassword();
          if (!password) {
            continue;
          }

          try {
            const derived = await deriveSubAccount(wallet, index, remote.name, password);
            if (remoteUpdatedAt) {
              derived.nameUpdatedAt = remoteUpdatedAt;
            }
            await saveAccount(derived);
            wallet.accountCount = Math.max(wallet.accountCount || 0, index + 1);
            await saveWallet(wallet);
            changed = true;
          } catch (error) {
            console.warn('[BackupSync] derive account failed:', error?.message || error);
          }
        }
      }

      if (remoteAccountCount != null) {
        const nextCount = Math.max(wallet.accountCount || 0, remoteAccountCount);
        if (nextCount !== wallet.accountCount) {
          wallet.accountCount = nextCount;
          await saveWallet(wallet);
          changed = true;
        }
      }

      await this._mergeContacts(remotePayload.contacts || []);
      await this._mergeNetworkIds(remotePayload.networkIds || []);
    } finally {
      this._suppressStorageEvents = false;
    }

    if (changed) {
      this._dirty = true;
      updateUserSetting(SETTINGS_KEYS.dirty, true).catch(() => {});
    }
  }

  _attachStorageListener() {
    if (this._unsubscribeStorage) return;

    this._unsubscribeStorage = onStorageChanged((changes, areaName) => {
      if (areaName !== 'local') return;
      if (this._suppressStorageEvents) return;

      const keys = Object.keys(changes || {});
      const relevant = keys.some(key => [
        WalletStorageKeys.ACCOUNTS,
        WalletStorageKeys.WALLETS,
        NetworkStorageKeys.NETWORKS,
        ContactsStorageKeys.CONTACTS
      ].includes(key));

      if (relevant) {
        this.markDirty('storage-change');
      }
    });
  }

  _schedulePush(reason) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.pushAll(`debounced:${reason}`).catch(async error => {
        console.warn('[BackupSync] debounced push failed:', error?.message || error);
        await this._appendActivityLog(this._buildLogEntry({
          level: 'error',
          action: 'push-error',
          reason: `debounced:${reason}`,
          message: this._formatSyncErrorMessage(`debounced:${reason}`, error)
        }));
      });
    }, SYNC_DEBOUNCE_MS);
  }

  async _ensureDirectory() {
    const prefix = await this._getAppScopePrefix();
    if (!prefix) return;
    const parts = prefix.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `${part}/`;
      await this._mkcol(this._dirPath(current));
    }
  }

  async _mkcol(path) {
    const response = await this._webdavRequest('MKCOL', path);
    if (!response) return;
    if (response.ok) return;
    if ([405, 409].includes(response.status)) return;
    throw new Error(`MKCOL failed: ${response.status}`);
  }

  async _probeRemote(context) {
    const primaryPath = await this._payloadPath(context.fingerprint);
    const primaryProbe = await this._probePath(primaryPath);
    if (primaryProbe?.exists || primaryProbe?.bypass) {
      return { ...primaryProbe, path: primaryPath };
    }
    if (primaryProbe && !primaryProbe.exists) {
      return { exists: false };
    }
    return null;
  }

  async _probePath(path) {
    const response = await this._webdavRequest('HEAD', path, {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    if (!response) return null;
    if (response.status === 404) return { exists: false };
    if ([405, 501].includes(response.status)) {
      return { exists: true, bypass: true };
    }
    if (!response.ok) {
      throw new Error(`WebDAV HEAD failed: ${response.status}`);
    }
    const etag = response.headers.get('ETag') || '';
    const lastModified = response.headers.get('Last-Modified') || '';
    return { exists: true, etag, lastModified };
  }

  async _webdavRequest(method, path, options = {}) {
    const endpoint = await this._resolveBaseEndpoint();
    if (!endpoint) {
      return null;
    }

    const url = joinUrl(endpoint, path);
    const headers = new Headers(options.headers || {});

    const authHeader = await this._getAuthHeader();
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }

    return fetch(url, {
      method,
      headers,
      body: options.body
    });
  }

  async _getAuthHeader() {
    const mode = await getUserSetting(SETTINGS_KEYS.authMode, 'ucan');

    if (mode === 'basic') {
      const basic = await getUserSetting(SETTINGS_KEYS.basicAuth, '');
      if (basic) {
        return basic.startsWith('Basic ') ? basic : `Basic ${basic}`;
      }
      return '';
    }

    if (mode === 'ucan') {
      const token = normalizeBearerToken(await getUserSetting(SETTINGS_KEYS.ucanToken, ''));
      return token ? `Bearer ${token}` : '';
    }

    const token = normalizeBearerToken(await getUserSetting(SETTINGS_KEYS.authToken, ''));
    return token ? `Bearer ${token}` : '';
  }

  async _hasAuth() {
    const mode = await getUserSetting(SETTINGS_KEYS.authMode, 'ucan');
    if (mode === 'basic') {
      const basic = await getUserSetting(SETTINGS_KEYS.basicAuth, '');
      return Boolean(basic);
    }
    if (mode === 'ucan') {
      const token = await getUserSetting(SETTINGS_KEYS.ucanToken, '');
      return Boolean(token);
    }
    const token = await getUserSetting(SETTINGS_KEYS.authToken, '');
    return Boolean(token);
  }

  async _isEnabled() {
    const enabled = await getUserSetting(SETTINGS_KEYS.enabled, true);
    const endpoint = await getUserSetting(SETTINGS_KEYS.endpoint, '');
    return Boolean(enabled && endpoint);
  }

  _getRemoteMetaEntry(fingerprint) {
    const meta = this._remoteMeta || {};
    const entry = meta[fingerprint];
    if (!entry || typeof entry !== 'object') return null;
    return entry;
  }

  _setRemoteMetaEntry(fingerprint, entry) {
    if (!fingerprint) return;
    const meta = this._remoteMeta && typeof this._remoteMeta === 'object' ? this._remoteMeta : {};
    meta[fingerprint] = {
      ...(meta[fingerprint] || {}),
      ...entry
    };
    this._remoteMeta = meta;
    updateUserSetting(SETTINGS_KEYS.remoteMeta, meta).catch(() => {});
  }

  _clearRemoteMetaEntry(fingerprint) {
    if (!fingerprint) return;
    const meta = this._remoteMeta && typeof this._remoteMeta === 'object' ? this._remoteMeta : {};
    if (!(fingerprint in meta)) return;
    delete meta[fingerprint];
    this._remoteMeta = meta;
    updateUserSetting(SETTINGS_KEYS.remoteMeta, meta).catch(() => {});
  }

  async _ensureDefaults() {
    const endpoint = await getUserSetting(SETTINGS_KEYS.endpoint, '');
    if (!endpoint) {
      await updateUserSetting(SETTINGS_KEYS.endpoint, DEFAULT_SYNC_ENDPOINT).catch(() => {});
    }

    const mode = await getUserSetting(SETTINGS_KEYS.authMode, '');
    if (!mode) {
      await updateUserSetting(SETTINGS_KEYS.authMode, 'ucan').catch(() => {});
    }

    const rawResource = await getUserSetting(SETTINGS_KEYS.ucanResource, '');
    const legacyResource = isLegacyUcanResource(rawResource);
    const normalizedResource = normalizeUcanResource(rawResource);
    if (normalizedResource !== rawResource) {
      await updateUserSetting(SETTINGS_KEYS.ucanResource, normalizedResource).catch(() => {});
    }

    const rawAction = await getUserSetting(SETTINGS_KEYS.ucanAction, '');
    const normalizedAction = normalizeUcanAction(rawAction, { forceDefault: legacyResource });
    if (normalizedAction !== rawAction) {
      await updateUserSetting(SETTINGS_KEYS.ucanAction, normalizedAction).catch(() => {});
    }

    if (legacyResource) {
      const existingToken = await getUserSetting(SETTINGS_KEYS.ucanToken, '');
      if (existingToken) {
        await updateUserSetting(SETTINGS_KEYS.ucanToken, '').catch(() => {});
      }
    }

    const enabled = await getUserSetting(SETTINGS_KEYS.enabled, null);
    if (enabled === null) {
      await updateUserSetting(SETTINGS_KEYS.enabled, true).catch(() => {});
    }
  }

  async _resolveBaseEndpoint() {
    const endpoint = await getUserSetting(SETTINGS_KEYS.endpoint, '');
    if (!endpoint) return '';

    const appId = await this._getAppScopeAppId();
    if (!appId) return endpoint;
    try {
      const url = new URL(endpoint);
      const pathname = url.pathname || '';
      const marker = `/${APP_SCOPE_PREFIX}/`;
      const idx = pathname.indexOf(marker);
      if (idx >= 0) {
        const rest = pathname.slice(idx + marker.length);
        const appSegment = rest.split('/')[0];
        if (appSegment === appId) {
          const basePath = pathname.slice(0, idx) || '/';
          url.pathname = basePath;
          url.search = '';
          url.hash = '';
          return url.toString();
        }
      }
    } catch {
      return endpoint;
    }

    return endpoint;
  }

  async _handlePendingDelete() {
    const pending = await getUserSetting(SETTINGS_KEYS.pendingDelete, false);
    if (!pending) return;
    await this._deleteRemoteAll().catch(() => {});
    await updateUserSetting(SETTINGS_KEYS.pendingDelete, false).catch(() => {});
  }

  async _deleteRemoteAll() {
    const contexts = Array.from(this._contexts.values());
    for (const context of contexts) {
      await this._deleteRemote(context).catch(() => {});
    }
  }

  async _deleteRemote(context) {
    const primaryPath = await this._payloadPath(context.fingerprint);
    const response = await this._webdavRequest('DELETE', primaryPath);
    if (!response) return;
    if (!response.ok && response.status !== 404) {
      throw new Error(`WebDAV DELETE failed: ${response.status}`);
    }
    this._clearRemoteMetaEntry(context.fingerprint);
  }

  async _mergeContacts(remoteContacts) {
    if (!Array.isArray(remoteContacts) || remoteContacts.length === 0) return;

    const localContacts = await getContactList();
    const localById = new Map();
    const localByAddress = new Map();

    (localContacts || []).forEach(contact => {
      if (!contact) return;
      if (contact.id) {
        localById.set(contact.id, contact);
      }
      const addr = String(contact.address || '').toLowerCase();
      if (addr) {
        localByAddress.set(addr, contact);
      }
    });

    let changed = false;

    for (const remote of remoteContacts) {
      if (!remote) continue;
      const remoteAddr = String(remote.address || '').toLowerCase();
      if (!remoteAddr) continue;

      const remoteUpdatedAt = remote.updatedAt || remote.createdAt || 0;
      const byId = remote.id ? localById.get(remote.id) : null;
      const byAddr = localByAddress.get(remoteAddr);
      const local = byId || byAddr;

      if (local) {
        const localUpdatedAt = local.updatedAt || local.createdAt || 0;
        if (remoteUpdatedAt > localUpdatedAt) {
          const updated = {
            ...local,
            id: local.id,
            name: remote.name || local.name,
            note: remote.note || '',
            address: remote.address || local.address,
            updatedAt: remoteUpdatedAt
          };
          await saveContact(updated);
          changed = true;
        } else if (remoteUpdatedAt === localUpdatedAt && (remote.name || '') !== (local.name || '')) {
          await this._recordConflict({
            id: `contact:${local.id}`,
            type: 'contact',
            contactId: local.id,
            address: local.address,
            localName: local.name || '',
            localNote: local.note || '',
            remoteName: remote.name || '',
            remoteNote: remote.note || '',
            timestamp: remoteUpdatedAt
          });
        }
        continue;
      }

      const newId = this._resolveContactId(remote.id, localById);
      const contact = {
        id: newId,
        name: remote.name || '',
        note: remote.note || '',
        address: remote.address,
        createdAt: remoteUpdatedAt || Date.now(),
        updatedAt: remoteUpdatedAt || Date.now()
      };
      await saveContact(contact);
      localById.set(contact.id, contact);
      localByAddress.set(remoteAddr, contact);
      changed = true;
    }

    if (changed) {
      this._dirty = true;
      updateUserSetting(SETTINGS_KEYS.dirty, true).catch(() => {});
    }
  }

  async _mergeNetworkIds(remoteNetworkIds) {
    if (!Array.isArray(remoteNetworkIds) || remoteNetworkIds.length === 0) return;
    const storedNetworkIds = await getUserSetting(SETTINGS_KEYS.networkIds, []);
    const union = Array.from(new Set([
      ...(Array.isArray(storedNetworkIds) ? storedNetworkIds : []),
      ...remoteNetworkIds.map(String)
    ]));
    if (JSON.stringify(union) !== JSON.stringify(storedNetworkIds || [])) {
      await updateUserSetting(SETTINGS_KEYS.networkIds, union).catch(() => {});
      this._dirty = true;
      updateUserSetting(SETTINGS_KEYS.dirty, true).catch(() => {});
    }
  }

  async _recordConflict(conflict) {
    if (!conflict || !conflict.id) return;
    const conflicts = await getUserSetting(SETTINGS_KEYS.conflicts, []);
    const list = Array.isArray(conflicts) ? [...conflicts] : [];
    if (!list.some(item => item?.id === conflict.id)) {
      list.push(conflict);
      await updateUserSetting(SETTINGS_KEYS.conflicts, list).catch(() => {});
      const summary = conflict.type === 'contact'
        ? '发现联系人冲突'
        : '发现账户冲突';
      await this._appendActivityLog(this._buildLogEntry({
        level: 'warn',
        action: 'conflict',
        reason: '',
        message: summary
      }));
    }
  }

  _formatSyncMessage(action, reason = '') {
    const label = this._formatSyncReason(reason);
    if (label) {
      return `${label}同步${action}`;
    }
    return `同步${action}`;
  }

  _formatSyncErrorMessage(reason, error) {
    const base = this._formatSyncMessage('失败', reason);
    const message = error?.message || error;
    if (!message) return base;
    return `${base}: ${message}`;
  }

  _formatSyncReason(reason = '') {
    if (!reason) return '';
    if (reason.startsWith('debounced:')) {
      const detail = reason.slice('debounced:'.length);
      return detail ? `本地变更(${detail})` : '本地变更';
    }
    switch (reason) {
      case 'manual':
        return '手动';
      case 'auto':
        return '自动';
      case 'unlock':
        return '解锁';
      case 'lock':
        return '锁定';
      default:
        return reason;
    }
  }

  _buildLogEntry({ level = 'info', action = '', reason = '', message = '', durationMs = null } = {}) {
    const random = Math.random().toString(36).slice(2, 8);
    const entry = {
      id: `sync_${Date.now()}_${random}`,
      time: getTimestamp(),
      level,
      action,
      reason,
      message
    };
    if (Number.isFinite(durationMs)) {
      entry.durationMs = durationMs;
    }
    return entry;
  }

  async _appendActivityLog(entry) {
    if (!entry) return;
    try {
      const logs = Array.isArray(this._activityLogs) ? [...this._activityLogs] : [];
      logs.unshift(entry);
      if (logs.length > MAX_ACTIVITY_LOGS) {
        logs.length = MAX_ACTIVITY_LOGS;
      }
      this._activityLogs = logs;
      await updateUserSetting(SETTINGS_KEYS.logs, logs);
    } catch (error) {
      console.warn('[BackupSync] append activity log failed:', error?.message || error);
    }
  }

  _resolveContactId(remoteId, localById) {
    if (remoteId && !localById.has(remoteId)) {
      return remoteId;
    }
    const random = Math.random().toString(36).slice(2, 8);
    return `contact_${Date.now()}_${random}`;
  }

  async _getCachedPassword() {
    const { getCachedPassword } = await import('./password-cache.js');
    return getCachedPassword();
  }

  async _payloadPath(fingerprint) {
    const prefix = await this._getAppScopePrefix();
    const filename = buildPayloadFilename(fingerprint);
    return `${prefix}${filename}`;
  }

  async _getAppScopeAppId() {
    const rawResource = await getUserSetting(SETTINGS_KEYS.ucanResource, '');
    const resource = normalizeUcanResource(rawResource);
    return extractAppIdFromResource(resource);
  }

  async _getAppScopePrefix() {
    const appId = await this._getAppScopeAppId();
    if (!appId) return '';
    return `${APP_SCOPE_PREFIX}/${appId}/`;
  }

  _dirPath(path) {
    return path.endsWith('/') ? path : `${path}/`;
  }
}

function joinUrl(base, path) {
  if (!base) return path;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return new URL(normalizedPath, normalizedBase).toString();
}

function buildPayloadFilename(fingerprint) {
  const safe = String(fingerprint || '').trim();
  if (!safe) return SYNC_FILENAME;
  return `payload.${safe}.json.enc`;
}

function isLegacyUcanResource(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();
  if (LEGACY_UCAN_RESOURCES.has(normalized)) return true;
  const legacyResource = `app:${LEGACY_DEFAULT_APP_ID}`;
  if (normalized === legacyResource) {
    return normalized !== getDefaultUcanResource().toLowerCase();
  }
  return false;
}

function normalizeUcanResource(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || isLegacyUcanResource(trimmed)) {
    return getDefaultUcanResource();
  }
  return trimmed;
}

function normalizeUcanAction(value, { forceDefault = false } = {}) {
  const trimmed = String(value || '').trim();
  if (forceDefault || !trimmed || trimmed === '*') {
    return DEFAULT_UCAN_ACTION;
  }
  return trimmed;
}

function extractAppIdFromResource(resource) {
  const trimmed = String(resource || '').trim();
  if (!trimmed.toLowerCase().startsWith('app:')) return '';
  const appId = trimmed.slice(4).trim();
  if (!appId || appId.includes('*')) return '';
  return appId;
}

function getDefaultUcanAppId() {
  try {
    const id = typeof chrome !== 'undefined' ? chrome?.runtime?.id : '';
    if (id) return String(id).toLowerCase();
  } catch {
    // ignore
  }
  return LEGACY_DEFAULT_APP_ID;
}

function getDefaultUcanResource() {
  return `app:${getDefaultUcanAppId()}`;
}

function normalizeBearerToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^Bearer\s+/i, '')
    .replace(/^UCAN\s+/i, '')
    .trim();
}

export const backupSyncService = new BackupSyncService();
