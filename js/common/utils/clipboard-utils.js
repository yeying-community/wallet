/**
 * 剪贴板操作工具函数
 */

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (!text) {
    return false;
  }

  try {
    // 现代浏览器 API
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch (error) {
    // 备用方法：使用 textarea
    return copyToClipboardFallback(text);
  }
}

/**
 * 剪贴板复用的备用方法
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>}
 */
async function copyToClipboardFallback(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = String(text);
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.setAttribute('readonly', '');
    
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    return success;
  } catch (fallbackError) {
    console.error('Clipboard fallback copy failed:', fallbackError);
    return false;
  }
}

/**
 * 从剪贴板读取文本
 * @returns {Promise<string>}
 */
export async function readFromClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch (error) {
    console.error('Read from clipboard failed:', error);
    return '';
  }
}

/**
 * 复制 HTML 内容到剪贴板
 * @param {string} html - HTML 内容
 * @param {string} text - 纯文本内容
 * @returns {Promise<boolean>}
 */
export async function copyHtmlToClipboard(html, text = '') {
  try {
    const type = 'text/html';
    const blobHtml = new Blob([html], { type });
    const blobText = new Blob([text], { type: 'text/plain' });
    
    const data = [new ClipboardItem({ [type]: blobHtml, 'text/plain': blobText })];
    
    await navigator.clipboard.write(data);
    return true;
  } catch (error) {
    console.error('Copy HTML to clipboard failed:', error);
    return false;
  }
}

/**
 * 复制文件到剪贴板（仅支持图片）
 * @param {Blob} blob - 文件 Blob
 * @returns {Promise<boolean>}
 */
export async function copyImageToClipboard(blob) {
  try {
    const type = blob.type || 'image/png';
    const data = { [type]: blob };
    const item = new ClipboardItem(data);
    
    await navigator.clipboard.write([item]);
    return true;
  } catch (error) {
    console.error('Copy image to clipboard failed:', error);
    return false;
  }
}

/**
 * 复制地址并显示成功提示
 * @param {string} address - 地址
 * @param {Function} showToast - 显示提示的函数
 * @returns {Promise<boolean>}
 */
export async function copyAddressToClipboard(address, showToast = null) {
  const success = await copyToClipboard(address);
  
  if (showToast) {
    showToast(success ? '地址已复制' : '复制失败');
  }
  
  return success;
}

/**
 * 复制交易哈希并显示成功提示
 * @param {string} txHash - 交易哈希
 * @param {Function} showToast - 显示提示的函数
 * @returns {Promise<boolean>}
 */
export async function copyTxHashToClipboard(txHash, showToast = null) {
  const success = await copyToClipboard(txHash);
  
  if (showToast) {
    showToast(success ? '交易哈希已复制' : '复制失败');
  }
  
  return success;
}

/**
 * 复制助记词并显示警告提示
 * @param {string} mnemonic - 助记词
 * @param {Function} showWarning - 显示警告的函数
 * @param {Function} showToast - 显示提示的函数
 * @returns {Promise<boolean>}
 */
export async function copyMnemonicToClipboard(mnemonic, showWarning = null, showToast = null) {
  if (showWarning) {
    showWarning('请勿将助记词透露给任何人！');
  }
  
  const success = await copyToClipboard(mnemonic);
  
  if (showToast) {
    showToast(success ? '助记词已复制' : '复制失败');
  }
  
  return success;
}

/**
 * 复制私钥并显示警告提示
 * @param {string} privateKey - 私钥
 * @param {Function} showWarning - 显示警告的函数
 * @param {Function} showToast - 显示提示的函数
 * @returns {Promise<boolean>}
 */
export async function copyPrivateKeyToClipboard(privateKey, showWarning = null, showToast = null) {
  if (showWarning) {
    showWarning('请勿将私钥透露给任何人！');
  }
  
  const success = await copyToClipboard(privateKey);
  
  if (showToast) {
    showToast(success ? '私钥已复制' : '复制失败');
  }
  
  return success;
}

/**
 * 检查剪贴板权限状态
 * @returns {Promise<string>}
 */
export async function getClipboardPermissionStatus() {
  if (!navigator.permissions) {
    return 'unknown';
  }
  
  try {
    const permission = await navigator.permissions.query({ name: 'clipboard-read' });
    return permission.state;
  } catch (error) {
    return 'unknown';
  }
}

/**
 * 请求剪贴板读取权限
 * @returns {Promise<boolean>}
 */
export async function requestClipboardPermission() {
  if (!navigator.permissions || !navigator.clipboard) {
    return true;
  }
  
  try {
    const permission = await navigator.permissions.query({ name: 'clipboard-read' });
    return permission.state === 'granted' || permission.state === 'prompt';
  } catch (error) {
    return true;
  }
}
