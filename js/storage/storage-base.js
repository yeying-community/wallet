/**
 * 基础存储操作
 * 提供统一的存储接口和错误处理
 */

import { createStorageError, logError } from '../common/errors/index.js';

/**
 * 获取存储数据
 * @param {string|string[]|null} keys - 存储键
 * @returns {Promise<Object>}
 */
export async function getStorage(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    logError('storage-get', error);
    throw createStorageError(`Failed to get storage: ${error.message}`);
  }
}

/**
 * 设置存储数据
 * @param {Object} items - 要存储的数据
 * @returns {Promise<void>}
 */
export async function setStorage(items) {
  try {
    await chrome.storage.local.set(items);
  } catch (error) {
    logError('storage-set', error);
    throw createStorageError(`Failed to set storage: ${error.message}`);
  }
}

/**
 * 删除存储数据
 * @param {string|string[]} keys - 要删除的键
 * @returns {Promise<void>}
 */
export async function removeStorage(keys) {
  try {
    await chrome.storage.local.remove(keys);
  } catch (error) {
    logError('storage-remove', error);
    throw createStorageError(`Failed to remove storage: ${error.message}`);
  }
}

/**
 * 清空所有存储
 * @returns {Promise<void>}
 */
export async function clearStorage() {
  try {
    await chrome.storage.local.clear();
    console.log('✅ All storage cleared');
  } catch (error) {
    logError('storage-clear', error);
    throw createStorageError(`Failed to clear storage: ${error.message}`);
  }
}

/**
 * 获取所有存储数据
 * @returns {Promise<Object>}
 */
export async function getAllStorage() {
  try {
    return await chrome.storage.local.get(null);
  } catch (error) {
    logError('storage-get-all', error);
    throw createStorageError(`Failed to get all storage: ${error.message}`);
  }
}

/**
 * 获取单个值
 * @param {string} key - 存储键
 * @param {any} defaultValue - 默认值
 * @returns {Promise<any>}
 */
export async function getValue(key, defaultValue = null) {
  try {
    const result = await getStorage(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  } catch (error) {
    logError('storage-get-value', error);
    return defaultValue;
  }
}

/**
 * 设置单个值
 * @param {string} key - 存储键
 * @param {any} value - 值
 * @returns {Promise<void>}
 */
export async function setValue(key, value) {
  try {
    await setStorage({ [key]: value });
  } catch (error) {
    logError('storage-set-value', error);
    throw createStorageError(`Failed to set value for key "${key}"`);
  }
}

/**
 * 获取 Map 类型数据
 * @param {string} key - 存储键
 * @returns {Promise<Object>}
 */
export async function getMap(key) {
  try {
    const result = await getStorage(key);
    return result[key] || {};
  } catch (error) {
    logError('storage-get-map', error);
    return {};
  }
}

/**
 * 设置 Map 类型数据
 * @param {string} key - 存储键
 * @param {Object} map - Map 数据
 * @returns {Promise<void>}
 */
export async function setMap(key, map) {
  try {
    await setStorage({ [key]: map });
  } catch (error) {
    logError('storage-set-map', error);
    throw createStorageError(`Failed to set map for key "${key}"`);
  }
}

/**
 * 获取 Map 中的单个项
 * @param {string} mapKey - Map 的存储键
 * @param {string} itemKey - 项的键
 * @returns {Promise<any>}
 */
export async function getMapItem(mapKey, itemKey) {
  try {
    const map = await getMap(mapKey);
    return map[itemKey] || null;
  } catch (error) {
    logError('storage-get-map-item', error);
    return null;
  }
}

/**
 * 设置 Map 中的单个项
 * @param {string} mapKey - Map 的存储键
 * @param {string} itemKey - 项的键
 * @param {any} itemValue - 项的值
 * @returns {Promise<void>}
 */
export async function setMapItem(mapKey, itemKey, itemValue) {
  try {
    const map = await getMap(mapKey);
    map[itemKey] = itemValue;
    await setMap(mapKey, map);
  } catch (error) {
    logError('storage-set-map-item', error);
    throw createStorageError(`Failed to set map item "${itemKey}" in "${mapKey}"`);
  }
}

/**
 * 删除 Map 中的单个项
 * @param {string} mapKey - Map 的存储键
 * @param {string} itemKey - 项的键
 * @returns {Promise<void>}
 */
export async function deleteMapItem(mapKey, itemKey) {
  try {
    const map = await getMap(mapKey);
    delete map[itemKey];
    await setMap(mapKey, map);
  } catch (error) {
    logError('storage-delete-map-item', error);
    throw createStorageError(`Failed to delete map item "${itemKey}" from "${mapKey}"`);
  }
}

/**
 * 删除 Map 中的多个项
 * @param {string} mapKey - Map 的存储键
 * @param {string[]} itemKeys - 项的键列表
 * @returns {Promise<void>}
 */
export async function deleteMapItems(mapKey, itemKeys) {
  try {
    const map = await getMap(mapKey);
    itemKeys.forEach(key => delete map[key]);
    await setMap(mapKey, map);
  } catch (error) {
    logError('storage-delete-map-items', error);
    throw createStorageError(`Failed to delete map items from "${mapKey}"`);
  }
}

/**
 * 获取数组类型数据
 * @param {string} key - 存储键
 * @returns {Promise<Array>}
 */
export async function getArray(key) {
  try {
    const result = await getStorage(key);
    return result[key] || [];
  } catch (error) {
    logError('storage-get-array', error);
    return [];
  }
}

/**
 * 设置数组类型数据
 * @param {string} key - 存储键
 * @param {Array} array - 数组数据
 * @returns {Promise<void>}
 */
export async function setArray(key, array) {
  try {
    await setStorage({ [key]: array });
  } catch (error) {
    logError('storage-set-array', error);
    throw createStorageError(`Failed to set array for key "${key}"`);
  }
}

/**
 * 监听存储变化
 * @param {Function} callback - 回调函数 (changes, areaName) => void
 * @returns {Function} 取消监听的函数
 */
export function onStorageChanged(callback) {
  chrome.storage.onChanged.addListener(callback);
  
  // 返回取消监听的函数
  return () => {
    chrome.storage.onChanged.removeListener(callback);
  };
}

