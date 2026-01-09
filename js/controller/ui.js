import { generateAvatar } from '../common/utils/index.js';

let currentPage = null;
let currentTab = 'tokens';

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

export function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  const tabBtn = document.getElementById(`${tabId}Tab`);
  if (tabBtn) {
    tabBtn.classList.add('active');
  }

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });

  const targetContent = document.getElementById(`${tabId}Content`);
  if (targetContent) {
    targetContent.classList.remove('hidden');
    currentTab = tabId;
    console.log(`[UI] 切换标签: ${tabId}`);
  }
}

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    console.log(`[UI] 打开模态框: ${modalId}`);
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    console.log(`[UI] 关闭模态框: ${modalId}`);
  }
}

export function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.add('hidden');
  });
}

export async function copyToClipboard(text, successMessage = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text);
    showSuccess(successMessage);
    console.log(`[UI] 复制成功: ${text.slice(0, 20)}...`);
  } catch (error) {
    console.error('[UI] 复制失败:', error);
    showError('复制失败，请手动复制');
  }
}

export function generateQRCode(content, elementId = 'qrcode', options = {}) {
  const container = document.getElementById(elementId);
  if (!container) {
    console.warn(`[UI] 二维码容器不存在: ${elementId}`);
    return;
  }

  container.innerHTML = '';

  if (!content) {
    container.innerHTML = '<span style="color: #999">无地址</span>';
    return;
  }

  try {
    if (typeof QRCode !== 'undefined') {
      const size = Number.isFinite(options?.size) ? options.size : null;
      const width = Number.isFinite(options?.width) ? options.width : (size || 150);
      const height = Number.isFinite(options?.height) ? options.height : (size || 150);
      new QRCode(container, {
        text: content,
        width,
        height,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      console.log(`[UI] 二维码生成成功: ${content.slice(0, 20)}...`);
    } else {
      container.innerHTML = '<span style="color: #999">二维码库未加载</span>';
      console.warn('[UI] QRCode 库未定义');
    }
  } catch (error) {
    console.error('[UI] 二维码生成失败:', error);
    container.innerHTML = '<span style="color: #999">二维码生成失败</span>';
  }
}

export function updateAccountInfo(account) {
  const nameEl = document.getElementById('accountName');
  if (nameEl) {
    nameEl.textContent = account?.name || '未知账户';
  }

  const avatarEl = document.getElementById('walletAvatar');
  if (avatarEl) {
    avatarEl.innerHTML = '';
    if (account?.address) {
      try {
        const size = avatarEl.clientWidth || 40;
        const canvas = generateAvatar(account.address, size);
        avatarEl.appendChild(canvas);
      } catch (error) {
        avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
      }
    } else {
      avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
    }
  }
}

export function updateBalance(balance) {
  const balanceEl = document.getElementById('balance');
  if (balanceEl) {
    const formatted = typeof balance === 'string'
      ? balance
      : parseFloat(balance || 0).toFixed(4);
    balanceEl.textContent = formatted;
  }
}

export function updateNetworkIndicator(chainId) {
  const indicators = document.querySelectorAll('.network-dot');
  if (!indicators || indicators.length === 0) return;
  const isMainnet = chainId === '1' || chainId === 1;
  indicators.forEach((indicator) => {
    indicator.style.backgroundColor = isMainnet ? '#10B981' : '#F59E0B';
  });
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

let activePasswordPrompt = null;

function ensurePasswordPromptModal() {
  let modal = document.getElementById('passwordPromptModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'passwordPromptModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="passwordPromptTitle">请输入密码</h3>
        <button class="btn-close" id="passwordPromptClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="passwordPromptInput">密码</label>
          <input
            type="password"
            id="passwordPromptInput"
            placeholder="输入密码"
          />
        </div>
        <div id="passwordPromptStatus" class="status"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="passwordPromptCancel">取消</button>
        <button class="btn btn-primary" id="passwordPromptConfirm">确认</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

export function promptPassword(options = {}) {
  if (activePasswordPrompt) {
    return activePasswordPrompt;
  }

  const {
    title = '请输入密码',
    confirmText = '确认',
    cancelText = '取消',
    placeholder = '输入密码',
    onConfirm
  } = options;

  const modal = ensurePasswordPromptModal();
  const overlay = modal.querySelector('.modal-overlay');
  const titleEl = document.getElementById('passwordPromptTitle');
  const input = document.getElementById('passwordPromptInput');
  const status = document.getElementById('passwordPromptStatus');
  const confirmBtn = document.getElementById('passwordPromptConfirm');
  const cancelBtn = document.getElementById('passwordPromptCancel');
  const closeBtn = document.getElementById('passwordPromptClose');

  if (titleEl) titleEl.textContent = title;
  if (confirmBtn) confirmBtn.textContent = confirmText;
  if (cancelBtn) cancelBtn.textContent = cancelText;
  if (input) input.placeholder = placeholder;
  confirmBtn?.removeAttribute('disabled');
  if (status) {
    status.textContent = '';
    status.className = 'status';
    status.style.display = 'none';
  }

  modal.classList.remove('hidden');
  setTimeout(() => {
    input?.focus();
  }, 0);

  const setStatus = (message, type = 'error') => {
    if (!status) return;
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
  };

  const clearStatus = () => {
    if (!status) return;
    status.textContent = '';
    status.className = 'status';
    status.style.display = 'none';
  };

  const cleanup = () => {
    confirmBtn?.removeEventListener('click', handleConfirm);
    cancelBtn?.removeEventListener('click', handleCancel);
    closeBtn?.removeEventListener('click', handleCancel);
    overlay?.removeEventListener('click', handleCancel);
    input?.removeEventListener('keypress', handleKeypress);
    modal.classList.add('hidden');
    activePasswordPrompt = null;
  };

  const handleCancel = () => {
    cleanup();
    resolvePromise(null);
  };

  const handleConfirm = async () => {
    if (!input) return;
    const password = input.value;
    if (!password) {
      setStatus('请输入密码', 'error');
      input.focus();
      return;
    }

    clearStatus();
    confirmBtn?.setAttribute('disabled', 'disabled');

    try {
      if (onConfirm) {
        await onConfirm(password);
      }
      cleanup();
      resolvePromise(password);
    } catch (error) {
      const message = error?.message || '密码错误';
      setStatus(message, 'error');
      if (input) {
        input.value = '';
        input.focus();
      }
      confirmBtn?.removeAttribute('disabled');
    }
  };

  const handleKeypress = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  let resolvePromise = () => { };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  confirmBtn?.addEventListener('click', handleConfirm);
  cancelBtn?.addEventListener('click', handleCancel);
  closeBtn?.addEventListener('click', handleCancel);
  overlay?.addEventListener('click', handleCancel);
  input?.addEventListener('keypress', handleKeypress);

  activePasswordPrompt = promise;
  return promise;
}

