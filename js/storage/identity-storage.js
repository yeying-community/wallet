import { getMap, getMapItem, setMapItem, deleteMapItem } from './storage-base.js';
import { IdentityStorageKeys } from './storage-keys.js';
import { encryptObject, decryptObject } from '../common/crypto/index.js';

export async function saveIdentity(identityId, record) {
  if (!identityId || !record?.document) throw new Error('Identity record is required');
  await setMapItem(IdentityStorageKeys.IDENTITIES, identityId, record);
  return record;
}

export async function saveEncryptedIdentity(identityId, record, password) {
  if (!password || typeof password !== 'string') throw new Error('Identity storage password is required');
  const { privateJwk, recoveryPrivateJwk, ...publicRecord } = record || {};
  if (!publicRecord?.document || !privateJwk || !recoveryPrivateJwk) throw new Error('Complete identity key material is required');
  const encryptedKeyMaterial = await encryptObject({ privateJwk, recoveryPrivateJwk }, password);
  return saveIdentity(identityId, { ...publicRecord, encryptedKeyMaterial });
}

export async function getIdentity(identityId) {
  return getMapItem(IdentityStorageKeys.IDENTITIES, identityId);
}

export async function getIdentities() {
  return getMap(IdentityStorageKeys.IDENTITIES);
}

export async function deleteIdentity(identityId) {
  return deleteMapItem(IdentityStorageKeys.IDENTITIES, identityId);
}

export async function decryptIdentityKeyMaterial(record, password) {
  if (!record?.encryptedKeyMaterial) throw new Error('Encrypted identity key material is missing');
  return decryptObject(record.encryptedKeyMaterial, password);
}

export async function saveIdentityCredentials(identityId, credentials) {
  const record = await getIdentity(identityId);
  if (!record) throw new Error('Identity not found');
  if (!Array.isArray(credentials)) throw new Error('Identity credentials must be an array');
  return saveIdentity(identityId, { ...record, credentials: [...credentials] });
}

export async function getIdentityCredentials(identityId) {
  const record = await getIdentity(identityId);
  return Array.isArray(record?.credentials) ? [...record.credentials] : [];
}
