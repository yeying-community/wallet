let currentPage = null;

export function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.add('hidden');
  });

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.remove('hidden');
    currentPage = pageId;
    console.log(`[UI] 切换到页面: ${pageId}`);
  } else {
    console.error(`[UI] 页面不存在: ${pageId}`);
  }
}

export function getCurrentPage() {
  return currentPage;
}

export function showToast(message, type = 'info', duration = 2000) {
  const toast = document.getElementById('globalToast');
  if (!toast) {
    console.warn('[UI] Toast 元素不存在');
    return;
  }

  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);

  console.log(`[UI] Toast [${type}]: ${message}`);
}

export function showSuccess(message, duration = 2000) {
  showToast(message, 'success', duration);
}

export function showError(message, duration = 3000) {
  showToast(message, 'error', duration);
}

export function showWarning(message, duration = 2000) {
  showToast(message, 'warning', duration);
}

export function showInfo(message, duration = 2000) {
  showToast(message, 'info', duration);
}

export function showStatus(elementId, message, type = 'info') {
  const statusEl = document.getElementById(elementId);
  if (!statusEl) {
    console.warn(`[UI] 状态元素不存在: ${elementId}`);
    return;
  }

  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000);
}

export function clearStatus(elementId) {
  const statusEl = document.getElementById(elementId);
  if (statusEl) {
    statusEl.style.display = 'none';
  }
}

export function setPageOrigin(pageId, origin) {
  const page = document.getElementById(pageId);
  if (page) {
    page.dataset.origin = origin;
  }
}

export function getPageOrigin(pageId, fallback = 'welcome') {
  const page = document.getElementById(pageId);
  return page?.dataset?.origin || fallback;
}

export * from './clipboard-ui.js';
export * from './html-ui.js';
export * from './qrcode-ui.js';
