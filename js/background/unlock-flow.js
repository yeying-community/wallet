/**
 * YeYing Wallet - 解锁流程管理
 * 负责：等待解锁、触发解锁窗口、通知等待者
 */

import { state } from './state.js';
import { TIMEOUTS } from '../config/index.js';
import { createInternalError, createUserRejectedError, createTimeoutError } from '../common/errors/index.js';
import { POPUP_DIMENSIONS } from '../config/index.js';
import { withPopupBoundsAsync } from './window-utils.js';
import { WalletMessageType } from '../protocol/extension-protocol.js';

const unlockWaiters = new Set();
let unlockPromise = null;
let unlockWindowId = null;
let unlockWindowCreated = false;

function findExistingPopupWindow() {
  const popupUrl = chrome.runtime.getURL('html/popup.html');
  return new Promise((resolve) => {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const list = Array.isArray(windows) ? windows : [];
      for (const win of list) {
        const tabs = Array.isArray(win.tabs) ? win.tabs : [];
        const popupTab = tabs.find(tab => typeof tab.url === 'string' && tab.url.startsWith(popupUrl));
        if (popupTab) {
          resolve({ window: win, tabId: popupTab.id });
          return;
        }
      }
      resolve(null);
    });
  });
}

function waitForUnlock(timeout = TIMEOUTS.APPROVAL) {
  if (state.keyring) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      unlockWaiters.delete(waiter);
      reject(createTimeoutError('Unlock timeout'));
    }, timeout);

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

export function requestUnlock() {
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
    const existingWindow = await findExistingPopupWindow();
    if (existingWindow) {
      unlockWindowId = existingWindow.window.id;
      unlockWindowCreated = false;
      chrome.windows.update(unlockWindowId, { focused: true }).catch(() => { });
      chrome.runtime.sendMessage({ type: WalletMessageType.SHOW_UNLOCK_PAGE }).catch(() => { });
      return waitForUnlockWithWindow();
    }

    const windowOptions = await withPopupBoundsAsync({
      url: 'html/popup.html',
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
    const cleanup = () => {
      chrome.windows.onRemoved.removeListener(windowRemovedListener);
      if (unlockWindowCreated && unlockWindowId) {
        chrome.windows.remove(unlockWindowId).catch(() => { });
      }
      unlockWindowId = null;
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

    waitForUnlock(TIMEOUTS.APPROVAL)
      .then(() => {
        cleanup();
        resolve(true);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}
