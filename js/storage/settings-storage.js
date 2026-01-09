/**
 * 设置存储
 * 管理用户设置的存储和读取
 */

import { SettingsStorageKeys } from './storage-keys.js';
import { getMap, setMap } from './storage-base.js';
import { logError } from '../common/errors/index.js';

/**
 * 获取用户设置
 * @returns {Promise<Object>}
 */
export async function getUserSettings() {
  try {
    return await getMap(SettingsStorageKeys.USER_SETTINGS);
  } catch (error) {
    logError('settings-storage-get', error);
    return {};
  }
}

/**
 * 保存用户设置
 * @param {Object} settings - 设置对象
 * @returns {Promise<void>}
 */
export async function saveUserSettings(settings) {
  try {
    await setMap(SettingsStorageKeys.USER_SETTINGS, settings);
    console.log('✅ User settings saved');
  } catch (error) {
    logError('settings-storage-save', error);
    throw error;
  }
}

/**
 * 获取单个设置项
 * @param {string} key - 设置键
 * @param {any} defaultValue - 默认值
 * @returns {Promise<any>}
 */
export async function getUserSetting(key, defaultValue = null) {
  try {
    const settings = await getUserSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  } catch (error) {
    logError('settings-storage-get-item', error);
    return defaultValue;
  }
}

/**
* 更新单个设置项
* @param {string} key - 设置键
* @param {any} value - 设置值
* @returns {Promise<void>}
*/
export async function updateUserSetting(key, value) {
  try {
    const settings = await getUserSettings();
    settings[key] = value;
    await saveUserSettings(settings);
    console.log('✅ User setting updated:', key);
  } catch (error) {
    logError('settings-storage-update-item', error);
    throw error;
  }
}

/**
* 删除单个设置项
* @param {string} key - 设置键
* @returns {Promise<void>}
*/
export async function deleteUserSetting(key) {
  try {
    const settings = await getUserSettings();
    delete settings[key];
    await saveUserSettings(settings);
    console.log('✅ User setting deleted:', key);
  } catch (error) {
    logError('settings-storage-delete-item', error);
    throw error;
  }
}

/**
* 
* 重置用户设置
* @returns {Promise<void>}
*/
export async function resetUserSettings() {
  try {
    await saveUserSettings({});
    console.log('✅ User settings reset');
  } catch (error) {
    logError('settings-storage-reset', error);
    throw error;
  }
}

/**
* 批量更新设置
* @param {Object} updates - 要更新的设置
* @returns {Promise<void>}
*/
export async function updateUserSettings(updates) {
  try {
    const settings = await getUserSettings();
    const newSettings = { ...settings, ...updates };
    await saveUserSettings(newSettings);
    console.log('✅ User settings updated:', Object.keys(updates).length);
  } catch (error) {
    logError('settings-storage-update-batch', error);
    throw error;
  }
}

