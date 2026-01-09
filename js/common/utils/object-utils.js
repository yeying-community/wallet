/**
 * 对象操作工具函数
 */

/**
 * 深度克隆对象
 * @param {any} obj - 要克隆的对象
 * @returns {any}
 */
export function deepClone(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // 处理日期
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  
  // 处理 Map
  if (obj instanceof Map) {
    const clonedMap = new Map();
    obj.forEach((value, key) => {
      clonedMap.set(deepClone(key), deepClone(value));
    });
    return clonedMap;
  }
  
  // 处理 Set
  if (obj instanceof Set) {
    const clonedSet = new Set();
    obj.forEach(value => {
      clonedSet.add(deepClone(value));
    });
    return clonedSet;
  }
  
  // 处理普通对象
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
  
  // 基本类型直接返回
  return obj;
}

/**
 * 深度合并对象
 * @param {Object} target - 目标对象
 * @param {...Object} sources - 源对象
 * @returns {Object}
 */
export function deepMerge(target, ...sources) {
  if (!sources.length) {
    return target;
  }
  
  const source = sources.shift();
  
  if (!source || typeof source !== 'object') {
    return target;
  }
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && target[key] && typeof target[key] === 'object') {
        // 两者都是对象，递归合并
        target[key] = deepMerge(target[key], source[key]);
      } else {
        // 直接赋值
        target[key] = source[key];
      }
    }
  }
  
  return deepMerge(target, ...sources);
}

/**
 * 浅合并对象
 * @param {Object} target - 目标对象
 * @param {...Object} sources - 源对象
 * @returns {Object}
 */
export function shallowMerge(target, ...sources) {
  return Object.assign(target, ...sources);
}

/**
 * 获取对象的嵌套属性值
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径（使用点分隔）
 * @param {any} defaultValue - 默认值
 * @returns {any}
 */
export function getNestedValue(obj, path, defaultValue = undefined) {
  if (!obj || !path) {
    return defaultValue;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || !current.hasOwnProperty(key)) {
      return defaultValue;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * 设置对象的嵌套属性值
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径（使用点分隔）
 * @param {any} value - 要设置的值
 * @returns {Object}
 */
export function setNestedValue(obj, path, value) {
  if (!obj || !path) {
    return obj;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    
    if (!current.hasOwnProperty(key) || current[key] === null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
  
  return obj;
}

/**
 * 删除对象的嵌套属性
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径（使用点分隔）
 * @returns {boolean}
 */
export function deleteNestedValue(obj, path) {
  if (!obj || !path) {
    return false;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    
    if (!current.hasOwnProperty(key) || current[key] === null || typeof current[key] !== 'object') {
      return false;
    }
    
    current = current[key];
  }
  
  const lastKey = keys[keys.length - 1];
  
  if (current.hasOwnProperty(lastKey)) {
    delete current[lastKey];
    return true;
  }
  
  return false;
}

/**
 * 检查对象是否有嵌套属性
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径（使用点分隔）
 * @returns {boolean}
 */
export function hasNestedProperty(obj, path) {
  return getNestedValue(obj, path, '__NOT_FOUND__') !== '__NOT_FOUND__';
}

/**
 * 从对象中选取指定属性
 * @param {Object} obj - 对象
 * @param {string[]} keys - 要选取的属性名数组
 * @returns {Object}
 */
export function pick(obj, keys) {
  if (!obj || !keys || !Array.isArray(keys)) {
    return {};
  }
  
  const result = {};
  
  for (const key of keys) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * 从对象中排除指定属性
 * @param {Object} obj - 对象
 * @param {string[]} keys - 要排除的属性名数组
 * @returns {Object}
 */
export function omit(obj, keys) {
  if (!obj || !keys || !Array.isArray(keys)) {
    return obj;
  }
  
  const result = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !keys.includes(key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * 将对象转换为数组
 * @param {Object} obj - 对象
 * @param {Function} mapper - 映射函数
 * @returns {Array}
 */
export function objectToArray(obj, mapper = null) {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  
  const result = [];
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = mapper ? mapper(obj[key], key) : obj[key];
      result.push({ key, value });
    }
  }
  
  return result;
}

/**
 * 将数组转换为对象
 * @param {Array} arr - 数组
 * @param {string} keyField - 作为键的字段名
 * @returns {Object}
 */
export function arrayToObject(arr, keyField = 'id') {
  if (!Array.isArray(arr)) {
    return {};
  }
  
  const result = {};
  
  for (const item of arr) {
    if (item && item.hasOwnProperty(keyField)) {
      result[item[keyField]] = item;
    }
  }
  
  return result;
}

/**
 * 根据条件过滤对象属性
 * @param {Object} obj - 对象
 * @param {Function} predicate - 过滤条件
 * @returns {Object}
 */
export function filterObject(obj, predicate) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  
  const result = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && predicate(obj[key], key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * 映射对象属性值
 * @param {Object} obj - 对象
 * @param {Function} mapper - 映射函数
 * @returns {Object}
 */
export function mapObject(obj, mapper) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  
  const result = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = mapper(obj[key], key);
    }
  }
  
  return result;
}

/**
 * 遍历对象属性
 * @param {Object} obj - 对象
 * @param {Function} callback - 回调函数
 */
export function forEachObject(obj, callback) {
  if (!obj || typeof obj !== 'object') {
    return;
  }
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      callback(obj[key], key);
    }
  }
}

/**
 * 检查对象是否为空
 * @param {Object} obj - 对象
 * @returns {boolean}
 */
export function isEmptyObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return true;
  }
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      return false;
    }
  }
  
  return true;
}

/**
 * 获取对象大小
 * @param {Object} obj - 对象
 * @returns {number}
 */
export function getObjectSize(obj) {
  if (!obj || typeof obj !== 'object') {
    return 0;
  }
  
  let count = 0;
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      count++;
    }
  }
  
  return count;
}

/**
 * 反转对象的键值对
 * @param {Object} obj - 对象
 * @returns {Object}
 */
export function invertObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  
  const result = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[obj[key]] = key;
    }
  }
  
  return result;
}

/**
 * 创建纯对象（排除原型链属性）
 * @param {Object} obj - 对象
 * @returns {Object}
 */
export function createPlainObject(obj = {}) {
  const result = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * 冻结对象（深度冻结）
 * @param {Object} obj - 对象
 * @returns {Object}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // 冻结属性
  Object.keys(obj).forEach(key => deepFreeze(obj[key]));
  
  return Object.freeze(obj);
}

