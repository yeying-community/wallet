/**
 * HTML 处理工具函数
 */

/**
 * 转义 HTML 特殊字符
 * @param {string} text - 要转义的文本
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }

  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * 移除 HTML 标签
 * @param {string} html - HTML 字符串
 * @returns {string}
 */
export function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * 将换行符转换为 HTML <br> 标签
 * @param {string} text - 文本
 * @returns {string}
 */
export function nl2br(text) {
  return String(text).replace(/\n/g, '<br>');
}

/**
 * 将 HTML <br> 标签转换为换行符
 * @param {string} html - HTML 字符串
 * @returns {string}
 */
export function br2nl(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n');
}

/**
 * 截断文本并添加省略号
 * @param {string} text - 文本
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 省略号字符
 * @returns {string}
 */
export function truncateText(text, maxLength = 100, suffix = '...') {
  if (!text || text.length <= maxLength) {
    return text;
  }
  
  return String(text).slice(0, maxLength - suffix.length) + suffix;
}

/**
 * 移除字符串首尾空白字符
 * @param {string} text - 文本
 * @returns {string}
 */
export function trim(text) {
  return String(text).trim();
}

/**
 * 移除字符串中多余空格
 * @param {string} text - 文本
 * @returns {string}
 */
export function normalizeSpaces(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * 将文本首字母大写
 * @param {string} text - 文本
 * @returns {string}
 */
export function capitalizeFirst(text) {
  const str = String(text);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 将每个单词首字母大写
 * @param {string} text - 文本
 * @returns {string}
 */
export function capitalizeWords(text) {
  return String(text)
    .toLowerCase()
    .split(' ')
    .map(word => capitalizeFirst(word))
    .join(' ');
}

/**
 * 将驼峰命名转换为短横线命名
 * @param {string} text - 驼峰命名字符串
 * @returns {string}
 */
export function camelToKebab(text) {
  return String(text).replace(/([a-z])([A-Z])/g, '\$1-\$2').toLowerCase();
}

/**
 * 将短横线命名转换为驼峰命名
 * @param {string} text - 短横线命名字符串
 * @returns {string}
 */
export function kebabToCamel(text) {
  return String(text).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * 将下划线命名转换为驼峰命名
 * @param {string} text - 下划线命名字符串
 * @returns {string}
 */
export function snakeToCamel(text) {
  return String(text).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * 将驼峰命名转换为下划线命名
 * @param {string} text - 驼峰命名字符串
 * @returns {string}
 */
export function camelToSnake(text) {
  return String(text).replace(/([a-z])([A-Z])/g, '\$1_\$2').toLowerCase();
}

/**
 * 移除字符串中的所有空白字符
 * @param {string} text - 文本
 * @returns {string}
 */
export function removeWhitespace(text) {
  return String(text).replace(/\s+/g, '');
}

/**
 * 重复字符串指定次数
 * @param {string} text - 文本
 * @param {number} count - 重复次数
 * @returns {string}
 */
export function repeatString(text, count = 1) {
  return String(text).repeat(Math.max(0, count));
}

/**
 * 填充字符串到指定长度
 * @param {string} text - 文本
 * @param {number} length - 目标长度
 * @param {string} char - 填充字符
 * @param {boolean} prepend - 是否在前面填充
 * @returns {string}
 */
export function padString(text, length = 2, char = '0', prepend = true) {
  const str = String(text);
  const padding = repeatString(char, Math.max(0, length - str.length));
  
  return prepend ? padding + str : str + padding;
}

/**
 * 模板字符串替换
 * @param {string} template - 模板字符串
 * @param {Object} data - 数据对象
 * @returns {string}
 */
export function templateReplace(template, data) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined ? data[key] : '';
  });
}
