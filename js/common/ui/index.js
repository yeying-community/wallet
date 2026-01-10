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
  if (duration <= 0) {
    toast.classList.add('toast-waiting');
  } else {
    toast.classList.remove('toast-waiting');
  }

  if (toast.dataset.timer) {
    clearTimeout(Number(toast.dataset.timer));
    delete toast.dataset.timer;
  }

  if (duration > 0) {
    const timerId = setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('toast-waiting');
      delete toast.dataset.timer;
    }, duration);
    toast.dataset.timer = String(timerId);
  }

  console.log(`[UI] Toast [${type}]: ${message}`);
}

export function hideToast() {
  const toast = document.getElementById('globalToast');
  if (!toast) return;

  if (toast.dataset.timer) {
    clearTimeout(Number(toast.dataset.timer));
    delete toast.dataset.timer;
  }

  toast.classList.add('hidden');
  toast.classList.remove('toast-waiting');
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

export function showWaiting(message = '等待中...') {
  showToast(message, 'info', 0);
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
