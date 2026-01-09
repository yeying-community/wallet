/**
 * 网络存储
 * 管理网络配置的存储和读取
 */

import { NetworkStorageKeys } from './storage-keys.js';
import { getValue, setValue, getArray, setArray } from './storage-base.js';
import { logError } from '../common/errors/index.js';

/**
 * 保存选中的网络名称
 * @param {string} networkName - 网络名称
 * @returns {Promise<void>}
 */
export async function saveSelectedNetworkName(networkName) {
  try {
    await setValue(NetworkStorageKeys.SELECTED_NETWORK, networkName);
    console.log('✅ Selected network saved:', networkName);
  } catch (error) {
    logError('network-storage-save-selected', error);
    throw error;
  }
}

/**
 * 获取选中的网络名称
 * @returns {Promise<string|null>}
 */
export async function getSelectedNetworkName() {
  try {
    return await getValue(NetworkStorageKeys.SELECTED_NETWORK, null);
  } catch (error) {
    logError('network-storage-get-selected', error);
    return null;
  }
}

/**
 * 保存自定义网络列表
 * @param {Array} networks - 网络列表
 * @returns {Promise<void>}
 */
export async function saveCustomNetworks(networks) {
  try {
    if (!Array.isArray(networks)) {
      throw new Error('Networks must be an array');
    }

    await setArray(NetworkStorageKeys.CUSTOM_NETWORKS, networks);
    console.log('✅ Custom networks saved:', networks.length);

  } catch (error) {
    logError('network-storage-save-custom', error);
    throw error;
  }
}

/**
 * 获取自定义网络列表
 * @returns {Promise<Array>}
 */
export async function getCustomNetworks() {
  try {
    return await getArray(NetworkStorageKeys.CUSTOM_NETWORKS);
  } catch (error) {
    logError('network-storage-get-custom', error);
    return [];
  }
}

/**
 * 添加自定义网络
 * @param {Object} network - 网络对象
 * @returns {Promise<void>}
 */
export async function addCustomNetwork(network) {
  try {
    const networks = await getCustomNetworks();
    
    // 检查是否已存在
    const exists = networks.some(n => n.chainId === network.chainId);
    if (exists) {
      throw new Error(`Network with chainId ${network.chainId} already exists`);
    }

    networks.push(network);
    await saveCustomNetworks(networks);
    console.log('✅ Custom network added:', network.name);
  } catch (error) {
    logError('network-storage-add-custom', error);
    throw error;
  }
}

/**
 * 删除自定义网络
 * @param {string} chainId - 链 ID
 * @returns {Promise<void>}
 */
export async function deleteCustomNetwork(chainId) {
  try {
  try {
    const networks = await getCustomNetworks();
    const filtered = networks.filter(n => n.chainId !== chainId);
    
    await saveCustomNetworks(filtered);
    console.log('✅ Custom network deleted:', chainId);

  } catch (error) {
    logError('network-storage-delete-custom', error);
    throw error;
  }
}

/**
 * 更新自定义网络
 * @param {string} chainId - 链 ID
 * @param {Object} updates - 更新的字段
 * @returns {Promise<void>}
 */
export async function updateCustomNetwork(chainId, updates) {
  try {
    const networks = await getCustomNetworks();
    const index = networks.findIndex(n => n.chainId === chainId);
    
    if (index === -1) {
      throw new Error(`Network with chainId ${chainId} not found`);
    }

    networks[index] = { ...networks[index], ...updates };
    await saveCustomNetworks(networks);
    console.log('✅ Custom network updated:', chainId);
  } catch (error) {
    logError('network-storage-update-custom', error);
    throw error;
  }
}
