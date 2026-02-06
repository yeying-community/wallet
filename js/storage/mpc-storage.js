/**
 * MPC storage
 * Manage MPC-related data in chrome.storage.local.
 */

import { MpcStorageKeys } from './storage-keys.js';
import {
  getMap,
  setMapItem,
  getMapItem,
  deleteMapItem,
  getArray,
  setArray,
  getValue,
  setValue
} from './storage-base.js';
import { logError } from '../common/errors/index.js';

// ==================== Device ====================

export async function getMpcDeviceId() {
  try {
    return await getValue(MpcStorageKeys.MPC_DEVICE_ID, null);
  } catch (error) {
    logError('mpc-storage-get-device-id', error);
    return null;
  }
}

export async function setMpcDeviceId(deviceId) {
  try {
    await setValue(MpcStorageKeys.MPC_DEVICE_ID, deviceId || null);
  } catch (error) {
    logError('mpc-storage-set-device-id', error);
    throw error;
  }
}

export async function getMpcDeviceKeys() {
  try {
    return await getMap(MpcStorageKeys.MPC_DEVICE_KEYS);
  } catch (error) {
    logError('mpc-storage-get-device-keys', error);
    return {};
  }
}

export async function getMpcDeviceKey(deviceId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_DEVICE_KEYS, deviceId);
  } catch (error) {
    logError('mpc-storage-get-device-key', error);
    return null;
  }
}

export async function saveMpcDeviceKey(record) {
  try {
    if (!record || !record.id) {
      throw new Error('Invalid device key record');
    }
    await setMapItem(MpcStorageKeys.MPC_DEVICE_KEYS, record.id, record);
  } catch (error) {
    logError('mpc-storage-save-device-key', error);
    throw error;
  }
}

export async function deleteMpcDeviceKey(deviceId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_DEVICE_KEYS, deviceId);
  } catch (error) {
    logError('mpc-storage-delete-device-key', error);
    throw error;
  }
}

// ==================== Wallets ====================

export async function getMpcWallets() {
  try {
    return await getMap(MpcStorageKeys.MPC_WALLETS);
  } catch (error) {
    logError('mpc-storage-get-wallets', error);
    return {};
  }
}

export async function getMpcWallet(walletId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_WALLETS, walletId);
  } catch (error) {
    logError('mpc-storage-get-wallet', error);
    return null;
  }
}

export async function saveMpcWallet(wallet) {
  try {
    if (!wallet || !wallet.id) {
      throw new Error('Invalid MPC wallet');
    }
    await setMapItem(MpcStorageKeys.MPC_WALLETS, wallet.id, wallet);
  } catch (error) {
    logError('mpc-storage-save-wallet', error);
    throw error;
  }
}

export async function deleteMpcWallet(walletId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_WALLETS, walletId);
  } catch (error) {
    logError('mpc-storage-delete-wallet', error);
    throw error;
  }
}

export async function getMpcWalletList() {
  try {
    const wallets = await getMpcWallets();
    return Object.values(wallets);
  } catch (error) {
    logError('mpc-storage-get-wallet-list', error);
    return [];
  }
}

// ==================== Participants ====================

export async function getMpcParticipants() {
  try {
    return await getMap(MpcStorageKeys.MPC_PARTICIPANTS);
  } catch (error) {
    logError('mpc-storage-get-participants', error);
    return {};
  }
}

export async function getMpcParticipant(participantId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_PARTICIPANTS, participantId);
  } catch (error) {
    logError('mpc-storage-get-participant', error);
    return null;
  }
}

export async function saveMpcParticipant(participant) {
  try {
    if (!participant || !participant.id) {
      throw new Error('Invalid MPC participant');
    }
    await setMapItem(MpcStorageKeys.MPC_PARTICIPANTS, participant.id, participant);
  } catch (error) {
    logError('mpc-storage-save-participant', error);
    throw error;
  }
}

export async function deleteMpcParticipant(participantId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_PARTICIPANTS, participantId);
  } catch (error) {
    logError('mpc-storage-delete-participant', error);
    throw error;
  }
}

export async function getMpcParticipantList() {
  try {
    const participants = await getMpcParticipants();
    return Object.values(participants);
  } catch (error) {
    logError('mpc-storage-get-participant-list', error);
    return [];
  }
}

// ==================== Key Shares ====================

export async function getMpcKeyShares() {
  try {
    return await getMap(MpcStorageKeys.MPC_KEY_SHARES);
  } catch (error) {
    logError('mpc-storage-get-key-shares', error);
    return {};
  }
}

export async function getMpcKeyShare(shareId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_KEY_SHARES, shareId);
  } catch (error) {
    logError('mpc-storage-get-key-share', error);
    return null;
  }
}

export async function saveMpcKeyShare(share) {
  try {
    if (!share || !share.id) {
      throw new Error('Invalid MPC key share');
    }
    await setMapItem(MpcStorageKeys.MPC_KEY_SHARES, share.id, share);
  } catch (error) {
    logError('mpc-storage-save-key-share', error);
    throw error;
  }
}

export async function deleteMpcKeyShare(shareId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_KEY_SHARES, shareId);
  } catch (error) {
    logError('mpc-storage-delete-key-share', error);
    throw error;
  }
}

// ==================== Sessions ====================

export async function getMpcSessions() {
  try {
    return await getMap(MpcStorageKeys.MPC_SESSIONS);
  } catch (error) {
    logError('mpc-storage-get-sessions', error);
    return {};
  }
}

export async function getMpcSession(sessionId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_SESSIONS, sessionId);
  } catch (error) {
    logError('mpc-storage-get-session', error);
    return null;
  }
}

export async function saveMpcSession(session) {
  try {
    if (!session || !session.id) {
      throw new Error('Invalid MPC session');
    }
    await setMapItem(MpcStorageKeys.MPC_SESSIONS, session.id, session);
  } catch (error) {
    logError('mpc-storage-save-session', error);
    throw error;
  }
}

export async function deleteMpcSession(sessionId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_SESSIONS, sessionId);
  } catch (error) {
    logError('mpc-storage-delete-session', error);
    throw error;
  }
}

export async function getMpcSessionList() {
  try {
    const sessions = await getMpcSessions();
    return Object.values(sessions);
  } catch (error) {
    logError('mpc-storage-get-session-list', error);
    return [];
  }
}

// ==================== Sign Requests ====================

export async function getMpcSignRequests() {
  try {
    return await getMap(MpcStorageKeys.MPC_SIGN_REQUESTS);
  } catch (error) {
    logError('mpc-storage-get-sign-requests', error);
    return {};
  }
}

export async function getMpcSignRequest(requestId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_SIGN_REQUESTS, requestId);
  } catch (error) {
    logError('mpc-storage-get-sign-request', error);
    return null;
  }
}

export async function saveMpcSignRequest(request) {
  try {
    if (!request || !request.id) {
      throw new Error('Invalid MPC sign request');
    }
    await setMapItem(MpcStorageKeys.MPC_SIGN_REQUESTS, request.id, request);
  } catch (error) {
    logError('mpc-storage-save-sign-request', error);
    throw error;
  }
}

export async function deleteMpcSignRequest(requestId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_SIGN_REQUESTS, requestId);
  } catch (error) {
    logError('mpc-storage-delete-sign-request', error);
    throw error;
  }
}

// ==================== Messages ====================

export async function getMpcMessages() {
  try {
    return await getMap(MpcStorageKeys.MPC_MESSAGES);
  } catch (error) {
    logError('mpc-storage-get-messages', error);
    return {};
  }
}

export async function getMpcMessage(messageId) {
  try {
    return await getMapItem(MpcStorageKeys.MPC_MESSAGES, messageId);
  } catch (error) {
    logError('mpc-storage-get-message', error);
    return null;
  }
}

export async function saveMpcMessage(message) {
  try {
    if (!message || !message.id) {
      throw new Error('Invalid MPC message');
    }
    await setMapItem(MpcStorageKeys.MPC_MESSAGES, message.id, message);
  } catch (error) {
    logError('mpc-storage-save-message', error);
    throw error;
  }
}

export async function deleteMpcMessage(messageId) {
  try {
    await deleteMapItem(MpcStorageKeys.MPC_MESSAGES, messageId);
  } catch (error) {
    logError('mpc-storage-delete-message', error);
    throw error;
  }
}

export async function getMpcMessageList() {
  try {
    const messages = await getMpcMessages();
    return Object.values(messages);
  } catch (error) {
    logError('mpc-storage-get-message-list', error);
    return [];
  }
}

// ==================== Audit Logs ====================

export async function getMpcAuditLogs() {
  try {
    return await getArray(MpcStorageKeys.MPC_AUDIT_LOGS);
  } catch (error) {
    logError('mpc-storage-get-audit-logs', error);
    return [];
  }
}

export async function setMpcAuditLogs(logs = []) {
  try {
    await setArray(MpcStorageKeys.MPC_AUDIT_LOGS, Array.isArray(logs) ? logs : []);
  } catch (error) {
    logError('mpc-storage-set-audit-logs', error);
    throw error;
  }
}

export async function appendMpcAuditLog(entry) {
  try {
    const logs = await getMpcAuditLogs();
    logs.push(entry);
    await setArray(MpcStorageKeys.MPC_AUDIT_LOGS, logs);
  } catch (error) {
    logError('mpc-storage-append-audit-log', error);
    throw error;
  }
}

export async function clearMpcAuditLogs() {
  try {
    await setArray(MpcStorageKeys.MPC_AUDIT_LOGS, []);
  } catch (error) {
    logError('mpc-storage-clear-audit-logs', error);
    throw error;
  }
}

// ==================== Audit Export ====================

export async function getMpcAuditExportConfig() {
  try {
    const config = await getValue(MpcStorageKeys.MPC_AUDIT_EXPORT_CONFIG, null);
    return config || null;
  } catch (error) {
    logError('mpc-storage-get-audit-export-config', error);
    return null;
  }
}

export async function saveMpcAuditExportConfig(config) {
  try {
    await setValue(MpcStorageKeys.MPC_AUDIT_EXPORT_CONFIG, config || null);
  } catch (error) {
    logError('mpc-storage-save-audit-export-config', error);
    throw error;
  }
}

export async function getMpcAuditExportQueue() {
  try {
    return await getArray(MpcStorageKeys.MPC_AUDIT_EXPORT_QUEUE);
  } catch (error) {
    logError('mpc-storage-get-audit-export-queue', error);
    return [];
  }
}

export async function setMpcAuditExportQueue(queue = []) {
  try {
    await setArray(MpcStorageKeys.MPC_AUDIT_EXPORT_QUEUE, Array.isArray(queue) ? queue : []);
  } catch (error) {
    logError('mpc-storage-set-audit-export-queue', error);
    throw error;
  }
}

export async function enqueueMpcAuditExport(entry) {
  try {
    const queue = await getMpcAuditExportQueue();
    queue.push(entry);
    await setArray(MpcStorageKeys.MPC_AUDIT_EXPORT_QUEUE, queue);
  } catch (error) {
    logError('mpc-storage-enqueue-audit-export', error);
    throw error;
  }
}

export async function dequeueMpcAuditExport() {
  try {
    const queue = await getMpcAuditExportQueue();
    const item = queue.shift() || null;
    await setArray(MpcStorageKeys.MPC_AUDIT_EXPORT_QUEUE, queue);
    return item;
  } catch (error) {
    logError('mpc-storage-dequeue-audit-export', error);
    throw error;
  }
}

export async function clearMpcAuditExportQueue() {
  try {
    await setArray(MpcStorageKeys.MPC_AUDIT_EXPORT_QUEUE, []);
  } catch (error) {
    logError('mpc-storage-clear-audit-export-queue', error);
    throw error;
  }
}
