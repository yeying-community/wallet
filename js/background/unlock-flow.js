/**
 * YeYing Wallet - 解锁流程管理
 * 负责：等待解锁、触发解锁窗口、通知等待者
 */

import { state } from './state.js';
import { createInternalError, createUserRejectedError, createTimeoutError } from '../common/errors/index.js';
import { POPUP_DIMENSIONS } from '../config/index.js';
import { withPopupBoundsAsync } from './window-utils.js';
import { primeApprovalSessionWindow } from './approval-flow.js';

const unlockWaiters = new Set();
let unlockPromise = null;
let unlockWindowId = null;
let unlockWindowCreated = false;
let unlockApprovalTabId = null;

async function resolveWindowTabId(windowId) {
  if (!Number.isFinite(windowId)) return null;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs?.[0]?.id ?? null;
  } catch (error) {
    return null;
  }
}

function waitForUnlock(timeout = 0) {
  if (state.keyring) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    if (timeout > 0) {
      waiter.timer = setTimeout(() => {
        unlockWaiters.delete(waiter);
        reject(createTimeoutError('Unlock timeout'));
      }, timeout);
    }

    unlockWaiters.add(waiter);
  });
}

export function notifyUnlocked() {
  unlockWaiters.forEach(waiter => {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    waiter.resolve(true);
  });
  unlockWaiters.clear();
}

export function requestUnlock(context = {}) {
  if (state.keyring) {
    return Promise.resolve(true);
  }

  if (unlockPromise) {
    if (unlockWindowId) {
      chrome.windows.update(unlockWindowId, { focused: true }).catch(() => { });
    }
    return unlockPromise;
  }

  unlockPromise = (async () => {
    const windowOptions = await withPopupBoundsAsync({
      url: 'html/approval.html?type=unlock',
      type: 'popup',
      width: POPUP_DIMENSIONS.width,
      height: POPUP_DIMENSIONS.height,
      focused: true
    });

    return new Promise((resolve, reject) => {
      chrome.windows.create(windowOptions, (window) => {
        if (!window) {
          unlockPromise = null;
          reject(createInternalError('Failed to open unlock window'));
          return;
        }

        // 解锁弹窗不更新 popupBounds（仅由用户操作的主弹窗更新）

        unlockWindowId = window.id;
        unlockWindowCreated = true;
        resolveWindowTabId(window.id).then((tabId) => {
          unlockApprovalTabId = tabId;
          if (context?.origin) {
            primeApprovalSessionWindow(context.origin, context.tabId, window.id, tabId);
          }
        }).catch(() => { });

        waitForUnlockWithWindow()
          .then(resolve)
          .catch(reject);
      });
    });
  })();

  return unlockPromise;
}

function waitForUnlockWithWindow() {
  return new Promise((resolve, reject) => {
    const cleanup = (options = {}) => {
      const { closeWindow = false } = options;
      chrome.windows.onRemoved.removeListener(windowRemovedListener);
      if (closeWindow && unlockWindowCreated && unlockWindowId) {
        chrome.windows.remove(unlockWindowId).catch(() => { });
      }
      unlockWindowId = null;
      unlockApprovalTabId = null;
      unlockWindowCreated = false;
      unlockPromise = null;
    };

    const windowRemovedListener = (windowId) => {
      if (windowId === unlockWindowId) {
        cleanup();
        reject(createUserRejectedError('User closed unlock window'));
      }
    };

    chrome.windows.onRemoved.addListener(windowRemovedListener);

    waitForUnlock(0)
      .then(() => {
        cleanup();
        resolve(true);
      })
      .catch((error) => {
        cleanup({ closeWindow: true });
        reject(error);
      });
  });
}
