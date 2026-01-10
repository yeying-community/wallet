/**
 * 权限存储
 * 管理 DApp 连接权限的存储和读取
 */

import { PermissionStorageKeys } from './storage-keys.js';
import { getMap, setMap, getMapItem, setMapItem, deleteMapItem } from './storage-base.js';
import { logError } from '../common/errors/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';

/**
 * 获取所有授权
 * @returns {Promise<Object>} Map<origin, Permission>
 */
export async function getAllAuthorizations() {
  try {
    return await getMap(PermissionStorageKeys.CONNECTED_SITES);
  } catch (error) {
    logError('permission-storage-get-all', error);
    return {};
  }
}

/**
 * 保存授权
 * @param {string} origin - 网站来源
 * @param {string} address - 授权的地址
 * @returns {Promise<void>}
 */
export async function saveAuthorization(origin, address) {
  try {
    const permission = {
      address,
      timestamp: getTimestamp()
    };

    await setMapItem(PermissionStorageKeys.CONNECTED_SITES, origin, permission);
    console.log('✅ Authorization saved:', origin);

  } catch (error) {
    logError('permission-storage-save', error);
    throw error;
  }
}

/**
 * 检查是否已授权
 * @param {string} origin - 网站来源
 * @returns {Promise<boolean>}
 */
export async function isAuthorized(origin) {
  try {
    const permission = await getMapItem(PermissionStorageKeys.CONNECTED_SITES, origin);
    return permission !== null;
  } catch (error) {
    logError('permission-storage-is-authorized', error);
    return false;
  }
}

/**
 * 获取授权的地址
 * @param {string} origin - 网站来源
 * @returns {Promise<string|null>}
 */
export async function getAuthorizedAddress(origin) {
  try {
    const permission = await getMapItem(PermissionStorageKeys.CONNECTED_SITES, origin);
    return permission?.address || null;
  } catch (error) {
    logError('permission-storage-get-address', error);
    return null;
  }
}

/**
 * 获取授权信息
 * @param {string} origin - 网站来源
 * @returns {Promise<Object|null>}
 */
export async function getAuthorization(origin) {
  try {
    return await getMapItem(PermissionStorageKeys.CONNECTED_SITES, origin);
  } catch (error) {
    logError('permission-storage-get', error);
    return null;
  }
}

/**
 * 删除授权
 * @param {string} origin - 网站来源
 * @returns {Promise<void>}
 */
export async function deleteAuthorization(origin) {
  try {
    await deleteMapItem(PermissionStorageKeys.CONNECTED_SITES, origin);
    console.log('✅ Authorization deleted:', origin);
  } catch (error) {
    logError('permission-storage-delete', error);
    throw error;
  }
}

/**
 * 清除所有授权
 * @returns {Promise<void>}
 */
export async function clearAllAuthorizations() {
  try {
    await setMap(PermissionStorageKeys.CONNECTED_SITES, {});
    console.log('✅ All authorizations cleared');
  } catch (error) {
    logError('permission-storage-clear-all', error);
    throw error;
  }
}

/**
 * 获取授权列表
 * @returns {Promise<Array>} [{origin, address, timestamp}]
 */
export async function getAuthorizationList() {
  try {
    const authorizations = await getAllAuthorizations();
    return Object.entries(authorizations).map(([origin, permission]) => ({
      origin,
      ...permission
    }));
  } catch (error) {
    logError('permission-storage-get-list', error);
    return [];
  }
}
