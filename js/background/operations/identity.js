import {
  createWalletIdentity,
  signIdentityDocument,
  canonicalize
} from '../../common/identity/identity-document.js';
import {
  decryptIdentityKeyMaterial,
  deleteIdentity,
  getIdentities,
  getIdentity,
  saveEncryptedIdentity
} from '../../storage/identity-storage.js';
import { saveIdentityCredentials, getIdentityCredentials } from '../../storage/identity-storage.js';
import { getValue, setValue } from '../../storage/storage-base.js';
import { IdentityStorageKeys } from '../../storage/storage-keys.js';
import { IdentityClient } from '../identity-client.js';

function credentialTypes(item) {
  const token = item?.credential || item?.jwt || (typeof item === 'string' ? item : '');
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(`${encoded}${'='.repeat((4 - encoded.length % 4) % 4)}`));
    return Array.isArray(payload?.vc?.type) ? payload.vc.type : [];
  } catch {
    return Array.isArray(item?.type) ? item.type : [item?.type].filter(Boolean);
  }
}

function mergeIdentityCredentials(current, incoming) {
  const incomingTypes = new Set(incoming.flatMap(credentialTypes).filter(type => type !== 'VerifiableCredential'));
  return [...current.filter(item => !credentialTypes(item).some(type => incomingTypes.has(type))), ...incoming];
}

function publicRecord(record) {
  if (!record) return null;
  const { encryptedKeyMaterial, privateJwk, recoveryPrivateJwk, ...safe } = record;
  return safe;
}

function requirePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Identity password is required');
  }
}

export async function handleCreateIdentity({ password } = {}) {
  requirePassword(password);
  const identity = await createWalletIdentity();
  await saveEncryptedIdentity(identity.document.walletIdentityId, {
    document: identity.document,
    controllerId: identity.controllerId,
    publicJwk: identity.publicJwk,
    recoveryPublicJwk: identity.recoveryPublicJwk,
    privateJwk: identity.privateJwk,
    recoveryPrivateJwk: identity.recoveryPrivateJwk
  }, password);
  await setValue(IdentityStorageKeys.SELECTED_IDENTITY, identity.document.walletIdentityId);
  return publicRecord(await getIdentity(identity.document.walletIdentityId));
}

export async function handleListIdentities() {
  const identities = await getIdentities();
  const selectedIdentityId = await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  return {
    identities: Object.values(identities).map(publicRecord),
    selectedIdentityId
  };
}

export async function handleGetIdentity({ identityId } = {}) {
  const id = identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  return publicRecord(await getIdentity(id));
}

export async function handleSelectIdentity({ identityId } = {}) {
  const record = await getIdentity(identityId);
  if (!record) throw new Error('Identity not found');
  await setValue(IdentityStorageKeys.SELECTED_IDENTITY, identityId);
  return publicRecord(record);
}

export async function handleDeleteIdentity({ identityId, password } = {}) {
  requirePassword(password);
  const record = await getIdentity(identityId);
  if (!record) throw new Error('Identity not found');
  await decryptIdentityKeyMaterial(record, password);
  await deleteIdentity(identityId);
  if (await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null) === identityId) {
    await setValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  }
  return { identityId, deleted: true };
}

export async function handleExportIdentityDocument({ identityId } = {}) {
  return handleGetIdentity({ identityId });
}

export async function handleSignIdentityDocument({ identityId, document, password } = {}) {
  requirePassword(password);
  if (!document || typeof document !== 'object') throw new Error('Document is required');
  const id = identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  const record = await getIdentity(id);
  if (!record) throw new Error('Identity not found');
  const keyMaterial = await decryptIdentityKeyMaterial(record, password);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  return signIdentityDocument(document, privateKey, {
    verificationMethod: `${record.document.id}#${record.controllerId}`,
    purpose: 'assertionMethod'
  });
}

export async function handleSignIdentityAction({ identityId, signingPayload, password } = {}) {
  requirePassword(password);
  if (!signingPayload || typeof signingPayload !== 'object') throw new Error('Identity action payload is required');
  const id = identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  const record = await getIdentity(id);
  if (!record || signingPayload.identity !== record.document.id) throw new Error('Identity action context mismatch');
  const keyMaterial = await decryptIdentityKeyMaterial(record, password);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(canonicalize(signingPayload))));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return { challengeId: signingPayload.challengeId, signature: btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') };
}

export async function handleSaveIdentityCredentials({ identityId, credentials } = {}) {
  const id = identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!id) throw new Error('Identity not selected');
  const record = await saveIdentityCredentials(id, credentials);
  return { identityId: id, count: record.credentials.length };
}

export async function handleListIdentityCredentials({ identityId } = {}) {
  const id = identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!id) throw new Error('Identity not selected');
  return { identityId: id, credentials: await getIdentityCredentials(id) };
}

export async function handleRequestIdentityVerification(data = {}, dependencies = {}) {
  const identity = data.identity || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!identity) throw new Error('Identity not selected');
  const client = new IdentityClient({ endpoint: data.endpoint, fetchImpl: dependencies.fetchImpl });
  return client.requestIdentityVerification({
    types: data.types,
    identity: identity.startsWith('did:') ? identity : `did:yeying:${identity}`,
    account: data.account,
    email: data.email,
    username: data.username,
    ...(data.avatarUri ? { avatarUri: data.avatarUri } : {})
  });
}

export async function handleConfirmIdentityVerification(data = {}, dependencies = {}) {
  const identityId = data.identityId || await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!identityId) throw new Error('Identity not selected');
  const client = new IdentityClient({ endpoint: data.endpoint, fetchImpl: dependencies.fetchImpl });
  const result = await client.confirmIdentityVerification({ verificationId: data.verificationId, code: data.code, types: data.types });
  if (!Array.isArray(result?.credentials) || result.credentials.length === 0) throw new Error('IDENTITY_CREDENTIALS_MISSING');
  const current = await getIdentityCredentials(identityId);
  await saveIdentityCredentials(identityId, mergeIdentityCredentials(current, result.credentials));
  return result;
}
