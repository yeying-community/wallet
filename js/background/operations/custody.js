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
  getAccountList,
  getSelectedAccount,
  getWalletAccounts,
  saveWallet,
  saveAccount
} from '../../storage/index.js';
import { getIdentities, saveIdentity, decryptIdentityKeyMaterial } from '../../storage/identity-storage.js';
import { IdentityStorageKeys } from '../../storage/storage-keys.js';
import { getValue, setValue } from '../../storage/storage-base.js';
import { validateIdentityDocument } from '../../common/identity/identity-document.js';
import { getWalletMnemonic, getAccountPrivateKey, deriveSubAccount, WALLET_TYPE } from '../vault.js';
import { ensureTargetUcanToken } from '../target-ucan-manager.js';
import { CustodyClient } from '../custody-client.js';
import { handleImportHDWallet, handleImportPrivateKeyWallet, handleSwitchAccount } from './wallet.js';

const DEFAULT_CUSTODY_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_CUSTODY_UCAN_RESOURCE = 'custody';
const DEFAULT_CUSTODY_UCAN_ACTION = 'write';
const DEFAULT_CUSTODY_UCAN_TTL_HOURS = 24;
const LEGACY_DEFAULT_WALLET_NAMES = new Set(['HD Wallet', 'Imported Wallet']);

export function resolveCustodyWalletName(wallet, accounts = []) {
  const storedName = String(wallet?.name || '').trim();
  const primaryAccount = accounts.find(account => Number(account?.index) === 0) || accounts[0];
  const primaryName = String(primaryAccount?.name || '').trim();
  if (!storedName || LEGACY_DEFAULT_WALLET_NAMES.has(storedName)) {
    return primaryName || storedName || '钱包';
  }
  return storedName;
}

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

export async function onCustodyUnlocked(password) {
  const settings = await getCustodySettingsRaw();
  if (!settings.enabled) return { enabled: false };
  await ensureCustodyToken({
    endpoint: settings.endpoint,
    password,
    resource: settings.ucanResource,
    action: settings.ucanAction,
    audience: settings.ucanAudience
  });
  return { enabled: true };
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

  const accounts = (await getWalletAccounts(wallet.id))
    .sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0));
  const walletName = resolveCustodyWalletName(wallet, accounts);
  const keyItems = [];
  for (const item of accounts || []) {
    if (!item?.id || !item.encryptedPrivateKey) continue;
    keyItems.push({
      accountId: item.id,
      index: Number.isInteger(Number(item.index)) && Number(item.index) >= 0 ? Number(item.index) : 0,
      name: item.name || '',
      nameUpdatedAt: item.nameUpdatedAt || 0,
      username: item.username || '',
      usernameUpdatedAt: item.usernameUpdatedAt || 0,
      address: item.address || '',
      derivationPath: item.derivationPath || '',
      createdAt: item.createdAt || null,
      privateKey: await getAccountPrivateKey(item, password)
    });
  }
  if (!keyItems.length) {
    throw new Error('当前钱包没有可托管的密钥');
  }

  const secret = {
    version: 2,
    wallet: {
      id: wallet.id,
      name: walletName,
      type: wallet.type || '',
      createdAt: wallet.createdAt || null,
      accountCount: wallet.accountCount || keyItems.length
    },
    mnemonic: wallet.type === 'hd' ? await getWalletMnemonic(wallet, password) : '',
    accounts: keyItems,
    identities: Object.fromEntries(await Promise.all(Object.entries(await getIdentities()).map(async ([id, record]) => {
      await decryptIdentityKeyMaterial(record, password);
      return [id, record];
    }))),
    selectedIdentityId: await getValue(IdentityStorageKeys.SELECTED_IDENTITY),
    exportedAt: getTimestamp()
  };

  return {
    walletId: wallet.id,
    accountId: account.id,
    address: account.address || '',
    ciphertext: await encryptObject(secret, password),
    metadata: {
      version: 2,
      walletName,
      walletType: wallet.type || '',
      accountCount: keyItems.length,
      identityCount: Object.keys(secret.identities).length,
      hasWalletIdentity: Object.keys(secret.identities).length > 0,
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

export function validateCustodySecret(secret) {
  if (!secret || secret.version !== 2 || !secret.wallet || !Array.isArray(secret.accounts) || !secret.accounts.length || !secret.identities || typeof secret.identities !== 'object') {
    throw new Error('托管记录格式不受支持');
  }
  const accountIndex = (account, position) => {
    const explicitIndex = Number(account?.index);
    if (Number.isInteger(explicitIndex) && explicitIndex >= 0) return explicitIndex;
    const match = String(account?.derivationPath || '').match(/\/(\d+)'?$/);
    return match ? Number(match[1]) : position;
  };
  const accounts = secret.accounts.map((account, position) => ({
    ...account,
    index: accountIndex(account, position),
    name: String(account?.name || '').trim()
      || (accountIndex(account, position) === 0 ? String(secret.wallet.name || '').trim() : `账户 ${accountIndex(account, position) + 1}`)
  })).sort((a, b) => a.index - b.index);
  if (new Set(accounts.map(account => account.index)).size !== accounts.length) {
    throw new Error('托管记录包含重复账户索引');
  }
  if (accounts.some((account, position) => account.index !== position)) {
    throw new Error('托管记录账户索引不连续');
  }
  if (new Set(accounts.map(account => String(account.address || '').toLowerCase())).size !== accounts.length) {
    throw new Error('托管记录包含重复账户地址');
  }
  const first = accounts[0];
  const expected = String(first?.address || '').toLowerCase();
  if (!expected) throw new Error('托管记录缺少钱包地址');

  if (secret.wallet.type === WALLET_TYPE.HD) {
    if (!secret.mnemonic) throw new Error('托管记录缺少助记词');
    for (const account of accounts) {
      const path = account.derivationPath || `m/44'/60'/0'/0/${account.index}`;
      const derived = ethers.HDNodeWallet.fromPhrase(secret.mnemonic, undefined, path).address.toLowerCase();
      if (derived !== String(account.address || '').toLowerCase()) throw new Error('托管记录地址校验失败');
    }
    if (first.index !== 0) throw new Error('托管记录缺少 HD 主账户');
    return { type: WALLET_TYPE.HD, key: secret.mnemonic, wallet: secret.wallet, accounts, address: first.address, identities: secret.identities || {}, selectedIdentityId: secret.selectedIdentityId || '' };
  }

  if (secret.wallet.type !== WALLET_TYPE.IMPORTED) {
    throw new Error('托管记录钱包类型不受支持');
  }
  for (const account of accounts) {
    if (!account.privateKey) throw new Error('托管记录缺少私钥');
    const derived = new ethers.Wallet(account.privateKey).address.toLowerCase();
    if (derived !== String(account.address || '').toLowerCase()) throw new Error('托管记录地址校验失败');
  }
  if (accounts.length !== 1) throw new Error('导入钱包托管记录包含多个账户');
  return { type: WALLET_TYPE.IMPORTED, key: first.privateKey, wallet: secret.wallet, accounts, address: first.address, identities: secret.identities || {}, selectedIdentityId: secret.selectedIdentityId || '' };
}

function identityHasAccountCredential(record, address, chainKey = 'eip155:1') {
  const expectedAddress = String(address || '').toLowerCase();
  return (record?.credentials || []).some(item => {
    const token = item?.credential || item?.jwt || (typeof item === 'string' ? item : '');
    const encoded = String(token).split('.')[1];
    if (!encoded) return false;
    try {
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`));
      const types = Array.isArray(payload?.vc?.type) ? payload.vc.type : [payload?.vc?.type];
      const subject = payload?.vc?.credentialSubject || {};
      return types.includes('WalletAccountCredential')
        && subject.chainKey === chainKey
        && String(subject.address || '').toLowerCase() === expectedAddress;
    } catch { return false; }
  });
}

/**
 * Validate and decrypt all Wallet Identity material carried by a custody
 * snapshot. The snapshot map is keyed by walletIdentityId (`wid_*`), while
 * the signed document uses the DID form (`did:yeying:wid_*`) as its `id`.
 */
export async function validateCustodyIdentityMaterials(identities, password) {
  if (!identities || typeof identities !== 'object' || Array.isArray(identities)) {
    throw new Error('托管记录身份材料无效');
  }
  for (const [identityId, identity] of Object.entries(identities)) {
    if (!identity?.document
      || identity.document.walletIdentityId !== identityId
      || !identity.encryptedKeyMaterial) {
      throw new Error('托管记录身份材料无效');
    }
    validateIdentityDocument(identity.document);
    const keys = await decryptIdentityKeyMaterial(identity, password);
    if (!keys?.privateJwk || !keys?.recoveryPrivateJwk) {
      throw new Error('托管记录身份密钥材料无效');
    }
  }
  return true;
}

export async function importOrReuseCustodyWallet(material, password) {
  const expectedAddress = String(material.address || '').toLowerCase();
  const existing = (await getAccountList()).find(account => (
    String(account?.address || '').toLowerCase() === expectedAddress
  ));
  if (existing) {
    const switched = await handleSwitchAccount(existing.id, password);
    if (!switched?.success) {
      throw new Error('当前设备已存在相同地址的钱包，但托管钱包密码不匹配');
    }
    const wallet = await getWallet(existing.walletId);
    if (!wallet) throw new Error('当前设备的钱包记录不完整');
    if (wallet.type !== material.type) throw new Error('当前设备相同地址的钱包类型不匹配');
    wallet.name = String(material.wallet?.name || '').trim() || wallet.name;
    let primaryAccount = existing;
    if (material.type === WALLET_TYPE.HD) {
      const localAccounts = await getAccountList();
      for (const source of material.accounts) {
        let account = localAccounts.find(item => String(item?.address || '').toLowerCase() === String(source.address || '').toLowerCase());
        if (!account) {
          account = await deriveSubAccount(wallet, source.index, source.name, password);
          if (String(account.address || '').toLowerCase() !== String(source.address || '').toLowerCase()) {
            throw new Error('托管记录地址校验失败');
          }
          localAccounts.push(account);
        }
        if (account.walletId !== wallet.id) throw new Error('当前设备存在归属其他钱包的相同地址账户');
        account.name = source.name || account.name;
        account.nameUpdatedAt = source.nameUpdatedAt || account.nameUpdatedAt;
        account.username = source.username || '';
        account.usernameUpdatedAt = source.usernameUpdatedAt || 0;
        await saveAccount(account);
        if (source.index === 0) primaryAccount = account;
      }
      wallet.accountCount = localAccounts.filter(account => account.walletId === wallet.id).length;
    } else {
      existing.name = material.accounts[0]?.name || existing.name;
      existing.nameUpdatedAt = material.accounts[0]?.nameUpdatedAt || existing.nameUpdatedAt;
      existing.username = material.accounts[0]?.username || '';
      existing.usernameUpdatedAt = material.accounts[0]?.usernameUpdatedAt || 0;
      await saveAccount(existing);
    }
    await saveWallet(wallet);
    return { success: true, wallet, account: primaryAccount, reused: true };
  }
  const first = material.accounts[0];
  const result = material.type === WALLET_TYPE.HD
    ? await handleImportHDWallet(first.name, material.key, password)
    : await handleImportPrivateKeyWallet(first.name, material.key, password);
  if (!result?.success) return result;
  result.wallet.name = String(material.wallet?.name || '').trim() || result.wallet.name;
  Object.assign(result.account, {
    name: first.name || result.account.name,
    nameUpdatedAt: first.nameUpdatedAt || result.account.nameUpdatedAt,
    username: first.username || '',
    usernameUpdatedAt: first.usernameUpdatedAt || 0
  });
  await saveAccount(result.account);
  if (material.type === WALLET_TYPE.HD) {
    for (const source of material.accounts.filter(item => item.index > 0)) {
      const account = await deriveSubAccount(result.wallet, source.index, source.name, password);
      if (String(account.address || '').toLowerCase() !== String(source.address || '').toLowerCase()) {
        throw new Error('托管记录地址校验失败');
      }
      account.username = source.username || '';
      account.usernameUpdatedAt = source.usernameUpdatedAt || 0;
      account.nameUpdatedAt = source.nameUpdatedAt || account.nameUpdatedAt;
      await saveAccount(account);
    }
    result.wallet.accountCount = material.accounts.length;
  }
  await saveWallet(result.wallet);
  return result;
}

export async function handleRestoreCustodySecret(options = {}) {
  try {
    const walletId = String(options.walletId || '').trim();
    const password = String(options.password || '');
    if (!walletId) throw new Error('钱包标识不能为空');
    if (!password) throw new Error('请输入托管钱包密码');

    const recoveryToken = String(options.recoveryToken || '').trim();
    const client = recoveryToken
      ? new CustodyClient({ endpoint: options.endpoint || (await getCustodySettingsRaw()).endpoint })
      : await getAuthorizedCustodyClient(options);
    const record = recoveryToken
      ? await client.getRecoverySecret(walletId, recoveryToken)
      : await client.getSecret(walletId);
    if (!record?.ciphertext) throw new Error('托管记录缺少密文');
    const material = validateCustodySecret(await decryptObject(record.ciphertext, password));
    await validateCustodyIdentityMaterials(material.identities, password);
    const result = await importOrReuseCustodyWallet(material, password);
    if (!result?.success) throw new Error(result?.error || '恢复钱包失败');
    for (const [identityId, identity] of Object.entries(material.identities)) {
      await saveIdentity(identityId, identity);
    }
    const restoredAddress = result?.account?.address || material.accounts?.[0]?.address || '';
    const restoredChainKey = result?.account?.chainKey || `eip155:${result?.account?.chainId || 1}`;
    const linkedIdentity = Object.entries(material.identities || {})
      .find(([, identity]) => identityHasAccountCredential(identity, restoredAddress, restoredChainKey));
    const preferredIdentityId = linkedIdentity?.[0] || material.selectedIdentityId || '';
    if (preferredIdentityId) await setValue(IdentityStorageKeys.SELECTED_IDENTITY, preferredIdentityId);
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
