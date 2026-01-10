/**
 * 网络存储
 * 管理网络配置的存储和读取（统一 networks 列表）
 */

import { NetworkStorageKeys } from './storage-keys.js';
import { getValue, setValue, getArray, setArray } from './storage-base.js';
import { logError } from '../common/errors/index.js';
import { normalizeChainId } from '../common/chain/index.js';

const LEGACY_CUSTOM_NETWORKS_KEY = 'customNetworks';
const LEGACY_CONFIG_NETWORKS_KEY = 'networkConfigs';

function getChainIdKey(network) {
  if (!network) return null;
  const id = network.chainIdHex || network.chainId;
  try {
    return normalizeChainId(id);
  } catch {
    return id ? String(id) : null;
  }
}

function mergeNetworks(base, additions) {
  const result = Array.isArray(base) ? [...base] : [];
  const seen = new Set();
  result.forEach((item) => {
    const key = getChainIdKey(item);
    if (key) {
      seen.add(key);
    }
  });

  (additions || []).forEach((item) => {
    const key = getChainIdKey(item);
    if (!key || seen.has(key)) {
      return;
    }
    result.push(item);
    seen.add(key);
  });

  return result;
}

function normalizeNetwork(network) {
  if (!network) return null;
  let normalizedChainId = null;
  try {
    normalizedChainId = normalizeChainId(network.chainIdHex || network.chainId);
  } catch {
    normalizedChainId = network.chainIdHex || network.chainId || null;
  }

  const entry = { ...network };
  if (normalizedChainId) {
    entry.chainIdHex = normalizedChainId;
    entry.chainId = normalizedChainId;
  }
  return entry;
}

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
 * 保存网络列表
 * @param {Array} networks - 网络列表
 * @returns {Promise<void>}
 */
export async function saveNetworks(networks) {
  try {
    if (!Array.isArray(networks)) {
      throw new Error('Networks must be an array');
    }
    await setArray(NetworkStorageKeys.NETWORKS, networks);
    console.log('✅ Networks saved:', networks.length);
  } catch (error) {
    logError('network-storage-save', error);
    throw error;
  }
}

/**
 * 获取网络列表
 * @returns {Promise<Array>}
 */
export async function getNetworks() {
  try {
    return await getArray(NetworkStorageKeys.NETWORKS);
  } catch (error) {
    logError('network-storage-get', error);
    return [];
  }
}

/**
 * 初始化默认网络配置（如果不存在）
 * @param {Object} defaults - 默认网络配置对象
 * @returns {Promise<Array>}
 */
export async function ensureDefaultNetworks(defaults) {
  try {
    const existing = await getNetworks();
    let merged = Array.isArray(existing) ? existing : [];
    let changed = false;

    const legacyConfigs = await getArray(LEGACY_CONFIG_NETWORKS_KEY);
    const legacyCustoms = await getArray(LEGACY_CUSTOM_NETWORKS_KEY);
    const legacy = [...(legacyConfigs || []), ...(legacyCustoms || [])].filter(Boolean);

    if (legacy.length > 0) {
      const mergedLegacy = mergeNetworks(merged, legacy);
      if (mergedLegacy.length !== merged.length) {
        merged = mergedLegacy;
        changed = true;
      }
    }

    if (!merged || merged.length === 0) {
      merged = Object.entries(defaults || {}).map(([key, network]) => ({
        ...network,
        key
      }));
      changed = true;
    }

    if (changed) {
      await saveNetworks(merged);
    }

    return merged;
  } catch (error) {
    logError('network-storage-ensure-defaults', error);
    throw error;
  }
}

/**
 * 根据 key 获取网络配置
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
export async function getNetworkConfigByKey(key) {
  if (!key) return null;
  const networks = await getNetworks();
  let normalizedKey = null;
  try {
    normalizedKey = normalizeChainId(key);
  } catch {
    normalizedKey = key;
  }
  return networks.find(item => {
    if (!item) return false;
    if (item.key === key || item.id === key) return true;
    const id = item.chainIdHex || item.chainId;
    if (!id || !normalizedKey) return false;
    try {
      return normalizeChainId(id) === normalizedKey;
    } catch {
      return id === normalizedKey;
    }
  }) || null;
}

/**
 * 获取全部网络配置
 * @returns {Promise<Array>}
 */
export async function getAllNetworks() {
  return await getNetworks();
}

/**
 * 根据 chainId 获取网络配置
 * @param {string|number} chainId
 * @returns {Promise<Object|null>}
 */
export async function getNetworkByChainId(chainId) {
  if (!chainId) return null;
  let normalized;
  try {
    normalized = normalizeChainId(chainId);
  } catch {
    normalized = chainId;
  }
  const networks = await getNetworks();
  return networks.find(item => {
    const id = item?.chainIdHex || item?.chainId;
    if (!id) return false;
    try {
      return normalizeChainId(id) === normalized;
    } catch {
      return id === normalized;
    }
  }) || null;
}

/**
 * 添加网络
 * @param {Object} network
 * @returns {Promise<Object>}
 */
export async function addNetwork(network) {
  try {
    if (!network) {
      throw new Error('Network is required');
    }
    if (!network.chainId && !network.chainIdHex) {
      throw new Error('chainId is required');
    }
    if (!network.rpcUrl && !network.rpc) {
      throw new Error('rpcUrl is required');
    }

    const networks = await getNetworks();
    const normalizedChainId = normalizeChainId(network.chainIdHex || network.chainId);
    const exists = networks.some(item => {
      const id = item?.chainIdHex || item?.chainId;
      try {
        return normalizeChainId(id) === normalizedChainId;
      } catch {
        return false;
      }
    });
    if (exists) {
      throw new Error(`Network with chainId ${normalizedChainId} already exists`);
    }

    const entry = normalizeNetwork({
      ...network,
      rpcUrl: network.rpcUrl || network.rpc
    });

    networks.push(entry);
    await saveNetworks(networks);
    console.log('✅ Network added:', entry.name || entry.chainName || entry.chainId);
    return entry;
  } catch (error) {
    logError('network-storage-add', error);
    throw error;
  }
}

/**
 * 更新网络
 * @param {string} chainId
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export async function updateNetwork(chainId, updates) {
  try {
    if (!chainId) {
      throw new Error('chainId is required');
    }

    const normalizedChainId = normalizeChainId(chainId);
    const networks = await getNetworks();
    const index = networks.findIndex(item => {
      const id = item?.chainIdHex || item?.chainId;
      try {
        return normalizeChainId(id) === normalizedChainId;
      } catch {
        return false;
      }
    });

    if (index === -1) {
      throw new Error(`Network with chainId ${chainId} not found`);
    }

    const current = networks[index];
    const merged = {
      ...current,
      ...updates
    };
    const normalized = normalizeNetwork({
      ...merged,
      chainIdHex: current.chainIdHex || current.chainId,
      chainId: current.chainId
    });

    networks[index] = normalized;
    await saveNetworks(networks);
    console.log('✅ Network updated:', chainId);
    return normalized;
  } catch (error) {
    logError('network-storage-update', error);
    throw error;
  }
}

/**
 * 删除网络
 * @param {string} chainId
 * @returns {Promise<void>}
 */
export async function deleteNetwork(chainId) {
  try {
    if (!chainId) {
      throw new Error('chainId is required');
    }

    const normalizedChainId = normalizeChainId(chainId);
    const networks = await getNetworks();
    const filtered = networks.filter(item => {
      const id = item?.chainIdHex || item?.chainId;
      try {
        return normalizeChainId(id) !== normalizedChainId;
      } catch {
        return true;
      }
    });

    await saveNetworks(filtered);
    console.log('✅ Network deleted:', chainId);
  } catch (error) {
    logError('network-storage-delete', error);
    throw error;
  }
}
