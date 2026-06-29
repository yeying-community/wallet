/**
 * YeYing Wallet - 授权站点操作
 * 负责：已授权站点列表、UCAN 会话查询、撤销授权
 */
import { EventType } from '../../protocol/dapp-protocol.js';
import { state } from '../state.js';
import {
  getAuthorizationList,
  deleteAuthorization,
  clearAllAuthorizations,
  getMap,
  UcanStorageKeys
} from '../../storage/index.js';
import { updateKeepAlive } from '../offscreen.js';
import { sendEvent } from '../connection.js';

/**
 * 获取授权网站列表
 * @returns {Promise<Object>} { success, sites }
 */
export async function handleGetAuthorizedSites() {
  try {
    const sites = await getAuthorizationList();
    return { success: true, sites };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get authorized sites' };
  }
}

/**
 * 获取指定网站的 UCAN 会话信息（当前有效优先，否则最近一次）
 * @param {string} origin
 * @param {string} address
 * @returns {Promise<Object>} { success, session }
 */
export async function handleGetSiteUcanSession(origin, address) {
  if (!origin) {
    return { success: false, error: 'origin is required' };
  }

  try {
    const sessionsMap = await getMap(UcanStorageKeys.UCAN_SESSIONS);
    const records = Object.values(sessionsMap || {});
    const filtered = records.filter(record => {
      if (!record) return false;
      if (origin && record.origin !== origin) return false;
      if (address && record.address !== address) return false;
      return true;
    });

    if (!filtered.length) {
      return { success: true, session: null };
    }

    const now = Date.now();
    const active = filtered.filter(record => record.expiresAt && record.expiresAt > now);
    const pickFrom = active.length ? active : filtered;
    pickFrom.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const selected = pickFrom[0];
    if (!selected) {
      return { success: true, session: null };
    }

    const isActive = selected.expiresAt ? selected.expiresAt > now : true;

    return {
      success: true,
      session: {
        id: selected.id,
        did: selected.did,
        createdAt: selected.createdAt,
        expiresAt: selected.expiresAt,
        isActive
      }
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get UCAN session' };
  }
}

/**
 * 撤销指定网站授权
 * @param {string} origin
 * @returns {Promise<Object>} { success }
 */
export async function handleRevokeSite(origin) {
  if (!origin) {
    return { success: false, error: 'origin is required' };
  }

  try {
    await deleteAuthorization(origin);
    state.connectedSites.delete(origin);
    updateKeepAlive();

    state.connections.forEach(({ port, origin: connOrigin }) => {
      if (connOrigin === origin) {
        sendEvent(port, EventType.ACCOUNTS_CHANGED, { accounts: [] });
      }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to revoke site' };
  }
}

/**
 * 清除所有授权
 * @returns {Promise<Object>} { success }
 */
export async function handleClearAllAuthorizations() {
  try {
    await clearAllAuthorizations();
    state.connectedSites.clear();
    updateKeepAlive();

    state.connections.forEach(({ port }) => {
      sendEvent(port, EventType.ACCOUNTS_CHANGED, { accounts: [] });
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear authorizations' };
  }
}
