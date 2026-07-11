/**
 * Key custody operations.
 */

import { encryptObject } from '../../common/crypto/index.js';
import { getTimestamp } from '../../common/utils/time-utils.js';
import {
  getUserSetting,
  updateUserSettings,
  getWallet,
  getSelectedAccount,
  getWalletAccounts
} from '../../storage/index.js';
import { getWalletMnemonic, getAccountPrivateKey } from '../vault.js';
import { ensureTargetUcanToken } from '../target-ucan-manager.js';
import { CustodyClient } from '../custody-client.js';

const DEFAULT_CUSTODY_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_CUSTODY_UCAN_RESOURCE = 'custody';
const DEFAULT_CUSTODY_UCAN_ACTION = 'write';
const DEFAULT_CUSTODY_UCAN_TTL_HOURS = 24;

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeBearerToken(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

async function getCustodySettingsRaw() {
  return {
    enabled: Boolean(await getUserSetting('custodyEnabled', false)),
    endpoint: await getUserSetting('custodyEndpoint', DEFAULT_CUSTODY_ENDPOINT),
    ucanResource: await getUserSetting('custodyUcanResource', DEFAULT_CUSTODY_UCAN_RESOURCE),
    ucanAction: await getUserSetting('custodyUcanAction', DEFAULT_CUSTODY_UCAN_ACTION),
    ucanAudience: await getUserSetting('custodyUcanAudience', ''),
    ucanToken: await getUserSetting('custodyUcanToken', ''),
    lastBackupAt: await getUserSetting('custodyLastBackupAt', ''),
    lastStatus: await getUserSetting('custodyLastStatus', null)
  };
}

function createClient(settings) {
  return new CustodyClient({
    endpoint: settings.endpoint,
    getToken: async () => normalizeBearerToken(await getUserSetting('custodyUcanToken', ''))
  });
}

async function ensureCustodyToken(options = {}) {
  const endpoint = normalizeEndpoint(
    options.endpoint || await getUserSetting('custodyEndpoint', DEFAULT_CUSTODY_ENDPOINT)
  );
  return await ensureTargetUcanToken({
    endpoint,
    tokenSettingKey: 'custodyUcanToken',
    audienceSettingKey: 'custodyUcanAudience',
    resourceSettingKey: 'custodyUcanResource',
    actionSettingKey: 'custodyUcanAction',
    defaultResource: DEFAULT_CUSTODY_UCAN_RESOURCE,
    defaultAction: DEFAULT_CUSTODY_UCAN_ACTION,
    ttlHours: options.ttlHours ?? DEFAULT_CUSTODY_UCAN_TTL_HOURS,
    password: options.password,
    audience: options.audience,
    resource: options.resource,
    action: options.action,
    forceRefresh: options.forceRefresh
  });
}

async function buildCustodyPayload(password) {
  const account = await getSelectedAccount();
  if (!account?.id || !account?.walletId) {
    throw new Error('未找到当前账户');
  }
  const wallet = await getWallet(account.walletId);
  if (!wallet?.id) {
    throw new Error('未找到当前钱包');
  }

  const accounts = await getWalletAccounts(wallet.id);
  const keyItems = [];
  for (const item of accounts || []) {
    if (!item?.id || !item.encryptedPrivateKey) continue;
    keyItems.push({
      accountId: item.id,
      address: item.address || '',
      derivationPath: item.derivationPath || '',
      privateKey: await getAccountPrivateKey(item, password)
    });
  }
  if (!keyItems.length) {
    throw new Error('当前钱包没有可托管的密钥');
  }

  const secret = {
    version: 1,
    wallet: {
      id: wallet.id,
      name: wallet.name || '',
      type: wallet.type || '',
      createdAt: wallet.createdAt || null,
      accountCount: wallet.accountCount || keyItems.length
    },
    mnemonic: wallet.type === 'hd' ? await getWalletMnemonic(wallet, password) : '',
    accounts: keyItems,
    exportedAt: getTimestamp()
  };

  return {
    walletId: wallet.id,
    accountId: account.id,
    address: account.address || '',
    ciphertext: await encryptObject(secret, password),
    metadata: {
      version: 1,
      walletType: wallet.type || '',
      accountCount: keyItems.length,
      exportedAt: secret.exportedAt
    }
  };
}

export async function handleGetCustodySettings() {
  try {
    return { success: true, settings: await getCustodySettingsRaw() };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get custody settings' };
  }
}

export async function handleUpdateCustodySettings(updates = {}) {
  try {
    const sanitized = {};
    if ('enabled' in updates) {
      sanitized.custodyEnabled = Boolean(updates.enabled);
    }
    if ('endpoint' in updates) {
      sanitized.custodyEndpoint = normalizeEndpoint(updates.endpoint);
    }
    if ('ucanResource' in updates) {
      sanitized.custodyUcanResource = String(updates.ucanResource || '').trim() || DEFAULT_CUSTODY_UCAN_RESOURCE;
    }
    if ('ucanAction' in updates) {
      sanitized.custodyUcanAction = String(updates.ucanAction || '').trim() || DEFAULT_CUSTODY_UCAN_ACTION;
    }
    if ('ucanAudience' in updates) {
      sanitized.custodyUcanAudience = String(updates.ucanAudience || '').trim();
    }
    if ('ucanToken' in updates) {
      sanitized.custodyUcanToken = normalizeBearerToken(updates.ucanToken);
    }
    if (Object.keys(sanitized).length > 0) {
      await updateUserSettings(sanitized);
    }
    return { success: true, settings: await getCustodySettingsRaw() };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update custody settings' };
  }
}

export async function handleGetCustodyStatus(options = {}) {
  try {
    const settings = await getCustodySettingsRaw();
    const endpoint = normalizeEndpoint(options.endpoint || settings.endpoint);
    if (!endpoint) {
      throw new Error('托管服务地址未配置');
    }
    await ensureCustodyToken({
      endpoint,
      password: options.password,
      resource: settings.ucanResource,
      action: settings.ucanAction,
      audience: settings.ucanAudience
    });
    const client = createClient({ ...settings, endpoint });
    const status = await client.getStatus();
    await updateUserSettings({ custodyLastStatus: status });
    return { success: true, status, settings: await getCustodySettingsRaw() };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get custody status' };
  }
}

export async function handleEnableCustody(options = {}) {
  try {
    const password = String(options.password || '');
    if (!password) {
      throw new Error('请输入钱包密码');
    }
    const settings = await getCustodySettingsRaw();
    const endpoint = normalizeEndpoint(options.endpoint || settings.endpoint);
    if (!endpoint) {
      throw new Error('托管服务地址未配置');
    }
    await ensureCustodyToken({
      endpoint,
      password,
      resource: options.ucanResource || settings.ucanResource,
      action: options.ucanAction || settings.ucanAction,
      audience: options.ucanAudience || settings.ucanAudience,
      forceRefresh: Boolean(options.forceRefresh)
    });
    const client = createClient({ ...settings, endpoint });
    const status = await client.getStatus();
    if (!status?.passkeyBound) {
      throw new Error('打开托管服务前，请先绑定通行证');
    }

    const payload = await buildCustodyPayload(password);
    const result = await client.upsertSecret(payload);
    await updateUserSettings({
      custodyEnabled: true,
      custodyEndpoint: endpoint,
      custodyLastBackupAt: getTimestamp(),
      custodyLastStatus: result?.status || status
    });
    return { success: true, result, settings: await getCustodySettingsRaw() };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to enable custody' };
  }
}

export async function handleDisableCustody(options = {}) {
  try {
    const settings = await getCustodySettingsRaw();
    const endpoint = normalizeEndpoint(options.endpoint || settings.endpoint);
    await ensureCustodyToken({
      endpoint,
      password: options.password,
      resource: settings.ucanResource,
      action: settings.ucanAction,
      audience: settings.ucanAudience
    });
    const account = await getSelectedAccount();
    const walletId = String(options.walletId || account?.walletId || '').trim();
    if (walletId) {
      const client = createClient({ ...settings, endpoint });
      await client.deleteSecret(walletId);
    }
    await updateUserSettings({
      custodyEnabled: false,
      custodyLastStatus: null
    });
    return { success: true, settings: await getCustodySettingsRaw() };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to disable custody' };
  }
}
