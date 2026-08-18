/**
 * Key custody operations.
 */

import { encryptObject, decryptObject } from '../../common/crypto/index.js';
import { getTimestamp } from '../../common/utils/time-utils.js';
import { ethers } from '../../../lib/ethers-6.16.esm.min.js';
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
import { handleImportHDWallet, handleImportPrivateKeyWallet } from './wallet.js';

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

async function getAuthorizedCustodyClient(options = {}) {
  const settings = await getCustodySettingsRaw();
  const endpoint = normalizeEndpoint(options.endpoint || settings.endpoint);
  if (!endpoint) throw new Error('托管服务地址未配置');
  await ensureCustodyToken({
    endpoint,
    password: options.password,
    resource: settings.ucanResource,
    action: settings.ucanAction,
    audience: settings.ucanAudience
  });
  return createClient({ ...settings, endpoint });
}

export async function handleListCustodySecrets(options = {}) {
  try {
    const recoveryToken = String(options.recoveryToken || '').trim();
    const client = recoveryToken
      ? new CustodyClient({ endpoint: options.endpoint || (await getCustodySettingsRaw()).endpoint })
      : await getAuthorizedCustodyClient(options);
    const secrets = recoveryToken
      ? await client.listRecoverySecrets(recoveryToken)
      : await client.listSecrets();
    return { success: true, secrets };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to list custody secrets' };
  }
}

export async function handleGetCustodySecret(options = {}) {
  try {
    const walletId = String(options.walletId || '').trim();
    if (!walletId) throw new Error('钱包标识不能为空');
    const client = await getAuthorizedCustodyClient(options);
    return { success: true, secret: await client.getSecret(walletId) };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get custody secret' };
  }
}

function validateCustodySecret(secret) {
  if (!secret || secret.version !== 1 || !secret.wallet || !Array.isArray(secret.accounts) || !secret.accounts.length) {
    throw new Error('托管记录格式不受支持');
  }
  const first = secret.accounts[0];
  const expected = String(first?.address || '').toLowerCase();
  if (!expected) throw new Error('托管记录缺少钱包地址');

  if (secret.wallet.type === 'hd') {
    if (!secret.mnemonic) throw new Error('托管记录缺少助记词');
    const path = first.derivationPath || "m/44'/60'/0'/0/0";
    const derived = ethers.HDNodeWallet.fromPhrase(secret.mnemonic, undefined, path).address.toLowerCase();
    if (derived !== expected) throw new Error('托管记录地址校验失败');
    return { type: 'hd', key: secret.mnemonic, name: secret.wallet.name || '恢复的钱包' };
  }

  if (!first.privateKey) throw new Error('托管记录缺少私钥');
  const derived = new ethers.Wallet(first.privateKey).address.toLowerCase();
  if (derived !== expected) throw new Error('托管记录地址校验失败');
  return { type: 'privateKey', key: first.privateKey, name: secret.wallet.name || '恢复的钱包' };
}

export async function handleRestoreCustodySecret(options = {}) {
  try {
    const walletId = String(options.walletId || '').trim();
    const password = String(options.password || '');
    if (!walletId) throw new Error('钱包标识不能为空');
    if (!password) throw new Error('请输入原钱包密码');

    const recoveryToken = String(options.recoveryToken || '').trim();
    const client = recoveryToken
      ? new CustodyClient({ endpoint: options.endpoint || (await getCustodySettingsRaw()).endpoint })
      : await getAuthorizedCustodyClient(options);
    const record = recoveryToken
      ? await client.getRecoverySecret(walletId, recoveryToken)
      : await client.getSecret(walletId);
    if (!record?.ciphertext) throw new Error('托管记录缺少密文');
    const material = validateCustodySecret(await decryptObject(record.ciphertext, password));
    const result = material.type === 'hd'
      ? await handleImportHDWallet(material.name, material.key, password)
      : await handleImportPrivateKeyWallet(material.name, material.key, password);
    if (!result?.success) throw new Error(result?.error || '恢复钱包失败');
    return { success: true, wallet: result.wallet, account: result.account };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to restore custody secret' };
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
