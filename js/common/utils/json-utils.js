/**
 * JSON 处理工具函数
 */

/**
 * 安全的 JSON 解析
 * @param {string} jsonString - JSON 字符串
 * @param {any} defaultValue - 默认值
 * @param {Function} reviver - 转换函数
 * @returns {any}
 */
export function safeJsonParse(jsonString, defaultValue = null, reviver = null) {
  if (!jsonString || typeof jsonString !== 'string') {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString, reviver);
  } catch (error) {
    console.error('JSON parse error:', error);
    return defaultValue;
  }
}

/**
 * 安全的 JSON 字符串化
 * @param {any} obj - 对象
 * @param {string} defaultValue - 默认值
 * @param {number} space - 缩进空格数
 * @returns {string}
 */
export function safeJsonStringify(obj, defaultValue = '{}', space = 0) {
  try {
    return JSON.stringify(obj, null, space);
  } catch (error) {
    console.error('JSON stringify error:', error);
    return defaultValue;
  }
}

/**
 * 深度克隆对象（使用 JSON 方法）
 * @param {any} obj - 对象
 * @returns {any}
 */
export function jsonClone(obj) {
  return safeJsonParse(safeJsonStringify(obj));
}

/**
 * 格式化 JSON 字符串
 * @param {string} jsonString - JSON 字符串
 * @param {number} indent - 缩进空格数
 * @returns {string}
 */
export function formatJson(jsonString, indent = 2) {
  try {
    const obj = JSON.parse(jsonString);
    return JSON.stringify(obj, null, indent);
  } catch (error) {
    console.error('Format JSON error:', error);
    return jsonString;
  }
}

/**
 * 压缩 JSON 字符串（移除空白）
 * @param {string} jsonString - JSON 字符串
 * @returns {string}
 */
export function minifyJson(jsonString) {
  try {
    const obj = JSON.parse(jsonString);
    return JSON.stringify(obj);
  } catch (error) {
    console.error('Minify JSON error:', error);
    return jsonString;
  }
}

/**
 * 检查字符串是否为有效的 JSON
 * @param {string} str - 字符串
 * @returns {boolean}
 */
export function isValidJson(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }

  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 JSON 中提取特定字段
 * @param {string} jsonString - JSON 字符串
 * @param {string[]} fields - 要提取的字段
 * @returns {Object}
 */
export function extractJsonFields(jsonString, fields) {
  try {
    const obj = JSON.parse(jsonString);
    const result = {};
    
    for (const field of fields) {
      if (obj.hasOwnProperty(field)) {
        result[field] = obj[field];
      }
    }
    
    return result;
  } catch (error) {
    console.error('Extract JSON fields error:', error);
    return {};
  }
}

/**
 * 从 JSON 中排除特定字段
 * @param {string} jsonString - JSON 字符串
 * @param {string[]} fields - 要排除的字段
 * @returns {string}
 */
export function omitJsonFields(jsonString, fields) {
  try {
    const obj = JSON.parse(jsonString);
    
    for (const field of fields) {
      delete obj[field];
    }
    
    return JSON.stringify(obj);
  } catch (error) {
    console.error('Omit JSON fields error:', error);
    return jsonString;
  }
}

/**
 * 合并两个 JSON 对象
 * @param {string} json1 - JSON 字符串1
 * @param {string} json2 - JSON 字符串2
 * @returns {string}
 */
export function mergeJson(json1, json2) {
  try {
    const obj1 = JSON.parse(json1);
    const obj2 = JSON.parse(json2);
    return JSON.stringify({ ...obj1, ...obj2 });
  } catch (error) {
    console.error('Merge JSON error:', error);
    return json1;
  }
}

/**
 * 获取 JSON 字符串的大小（字节）
 * @param {string} jsonString - JSON 字符串
 * @returns {number}
 */
export function getJsonSize(jsonString) {
  if (!jsonString) {
    return 0;
  }
  
  // 计算 UTF-8 字节数
  return new TextEncoder().encode(jsonString).length;
}

/**
 * 格式化 JSON 大小
 * @param {string} jsonString - JSON 字符串
 * @returns {string}
 */
export function formatJsonSize(jsonString) {
  const bytes = getJsonSize(jsonString);
  
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 将 BigInt 序列化为 JSON 安全的格式
 * @param {any} obj - 对象
 * @returns {any}
 */
export function serializeBigInt(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return { __type: 'BigInt', value: obj.toString() };
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInt(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = serializeBigInt(obj[key]);
      }
    }
    return result;
  }

  return obj;
}

/**
 * 将 BigInt 序列化格式还原为 BigInt
 * @param {any} obj - 对象
 * @returns {any}
 */
export function deserializeBigInt(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (obj && typeof obj === 'object' && obj.__type === 'BigInt') {
    return BigInt(obj.value);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deserializeBigInt(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = deserializeBigInt(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将包含 BigInt 的对象序列化为 JSON 字符串
 * @param {any} obj - 对象
 * @param {number} space - 缩进空格数
 * @returns {string}
 */
export function stringifyWithBigInt(obj, space = 0) {
  const serialized = serializeBigInt(obj);
  return JSON.stringify(serialized, null, space);
}

/**
 * 将 JSON 字符串解析为包含 BigInt 的对象
 * @param {string} jsonString - JSON 字符串
 * @returns {any}
 */
export function parseWithBigInt(jsonString) {
  const obj = JSON.parse(jsonString);
  return deserializeBigInt(obj);
}

/**
 * 将 Date 序列化为 JSON 安全的格式
 * @param {any} obj - 对象
 * @returns {any}
 */
export function serializeDate(obj) {
  if (obj instanceof Date) {
    return { __type: 'Date', value: obj.toISOString() };
  }

  if (Array.isArray(obj)) {
    return obj.map(item => serializeDate(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = serializeDate(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将 Date 序列化格式还原为 Date
 * @param {any} obj - 对象
 * @returns {any}
 */
export function deserializeDate(obj) {
  if (obj && typeof obj === 'object' && obj.__type === 'Date') {
    return new Date(obj.value);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deserializeDate(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = deserializeDate(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将包含 Date 的对象序列化为 JSON 字符串
 * @param {any} obj - 对象
 * @param {number} space - 缩进空格数
 * @returns {string}
 */
export function stringifyWithDate(obj, space = 0) {
  const serialized = serializeDate(obj);
  return JSON.stringify(serialized, null, space);
}

/**
 * 将 JSON 字符串解析为包含 Date 的对象
 * @param {string} jsonString - JSON 字符串
 * @returns {any}
 */
export function parseWithDate(jsonString) {
  const obj = JSON.parse(jsonString);
  return deserializeDate(obj);
}

/**
 * 将 Set 序列化为 JSON 安全的格式
 * @param {any} obj - 对象
 * @returns {any}
 */
export function serializeSet(obj) {
  if (obj instanceof Set) {
    return { __type: 'Set', value: Array.from(obj) };
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => serializeSet(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = serializeSet(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将 Set 序列化格式还原为 Set
 * @param {any} obj - 对象
 * @returns {any}
 */
export function deserializeSet(obj) {
  if (obj && typeof obj === 'object' && obj.__type === 'Set') {
    return new Set(obj.value);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deserializeSet(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = deserializeSet(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将 Map 序列化为 JSON 安全的格式
 * @param {any} obj - 对象
 * @returns {any}
 */
export function serializeMap(obj) {
  if (obj instanceof Map) {
    return { __type: 'Map', value: Array.from(obj.entries()) };
  }

  if (Array.isArray(obj)) {
    return obj.map(item => serializeMap(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = serializeMap(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 将 Map 序列化格式还原为 Map
 * @param {any} obj - 对象
 * @returns {any}
 */
export function deserializeMap(obj) {
  if (obj && typeof obj === 'object' && obj.__type === 'Map') {
    return new Map(obj.value);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deserializeMap(item));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = deserializeMap(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

