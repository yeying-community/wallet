/**
 * YeYing Wallet - 授权弹窗会话管理
 * 负责：复用同一站点/标签页的 connect + sign 审批弹窗
 */

import { createInternalError } from '../common/errors/index.js';
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
import { POPUP_DIMENSIONS } from '../config/index.js';
import { state } from './state.js';
import { updateKeepAlive } from './offscreen.js';
import { withPopupBoundsAsync } from './window-utils.js';

let windowCleanupBound = false;

function updatePendingRequestWindow(requestId, windowId, tabId) {
  const pendingRequest = state.pendingRequests.get(requestId);
  if (!pendingRequest) return;
  pendingRequest.windowId = windowId;
  pendingRequest.windowTabId = tabId;
}

function ensureWindowCleanupListener() {
  if (windowCleanupBound) return;
  chrome.windows.onRemoved.addListener((windowId) => {
    let changed = false;
    for (const [sessionKey, session] of state.approvalSessions.entries()) {
      if (session?.windowId !== windowId) continue;
      state.approvalSessions.delete(sessionKey);
      changed = true;
    }
    if (changed) {
      updateKeepAlive();
    }
  });
  windowCleanupBound = true;
}

async function resolveWindowTabId(windowId) {
  if (!Number.isFinite(windowId)) return null;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs?.[0]?.id ?? null;
  } catch (error) {
    return null;
  }
}

async function ensureApprovalSessionAlive(sessionKey, session) {
  if (!session?.windowId) {
    state.approvalSessions.delete(sessionKey);
    updateKeepAlive();
    return null;
  }

  try {
    await chrome.windows.get(session.windowId);
  } catch (error) {
    state.approvalSessions.delete(sessionKey);
    updateKeepAlive();
    return null;
  }

  const nextTabId = Number.isFinite(session.tabId)
    ? session.tabId
    : await resolveWindowTabId(session.windowId);

  if (!Number.isFinite(nextTabId)) {
    state.approvalSessions.delete(sessionKey);
    updateKeepAlive();
    return null;
  }

  if (session.tabId !== nextTabId) {
    session.tabId = nextTabId;
    updateKeepAlive();
  }

  return session;
}

function setApprovalSession(sessionKey, value) {
  if (!sessionKey) return;
  state.approvalSessions.set(sessionKey, value);
  updateKeepAlive();
}

function getQueuedRequestIds(session) {
  return Array.isArray(session?.queue) ? session.queue : [];
}

function enqueueSessionRequest(session, requestId) {
  const queue = getQueuedRequestIds(session);
  if (queue.includes(requestId)) {
    return queue;
  }
  return [...queue, requestId];
}

function notifyQueuedApproval(sessionKey, activeRequestId, queuedRequestId, queueSize) {
  chrome.runtime.sendMessage({
    type: ApprovalMessageType.APPROVAL_QUEUE_UPDATE,
    data: {
      sessionKey,
      activeRequestId,
      queuedRequestId,
      queueSize
    }
  }).catch(() => { });
}

export function getApprovalSessionKey(origin, tabId) {
  const normalizedOrigin = origin || 'unknown';
  const normalizedTabId = Number.isFinite(tabId) ? tabId : 'none';
  return `${normalizedOrigin}:${normalizedTabId}`;
}

export function getApprovalSession(origin, tabId) {
  const sessionKey = getApprovalSessionKey(origin, tabId);
  return state.approvalSessions.get(sessionKey) || null;
}

export function primeApprovalSessionWindow(origin, tabId, windowId, approvalTabId) {
  const sessionKey = getApprovalSessionKey(origin, tabId);
  ensureWindowCleanupListener();
  setApprovalSession(sessionKey, {
    windowId,
    tabId: approvalTabId,
    activeRequestId: null,
    lastRequestId: null,
    queue: [],
    updatedAt: Date.now()
  });
  return sessionKey;
}

export function hasActiveApprovalForSession(origin, tabId) {
  const session = getApprovalSession(origin, tabId);
  if (!session?.activeRequestId) return false;
  return state.pendingRequests.has(session.activeRequestId);
}

export function focusApprovalSession(origin, tabId) {
  const session = getApprovalSession(origin, tabId);
  if (!session?.windowId) return;
  chrome.windows.update(session.windowId, { focused: true }).catch(() => { });
}

export function findPendingRequest(type, origin, tabId) {
  for (const [requestId, request] of state.pendingRequests.entries()) {
    if (request.type !== type) continue;
    if (origin && request.origin !== origin) continue;
    if (typeof tabId === 'number' && request.tabId !== tabId) continue;
    return { requestId, request };
  }
  return null;
}

export function focusPendingWindow(pending) {
  const windowId = pending?.request?.windowId;
  if (!windowId) return;
  chrome.windows.update(windowId, { focused: true }).catch(() => { });
}

export function addPendingRequest(requestId, request) {
  state.pendingRequests.set(requestId, request);

  if (request?.reuseSession) {
    request.sessionKey = getApprovalSessionKey(request.origin, request.tabId);
  }

  updateKeepAlive();
}

export function removePendingRequest(requestId, options = {}) {
  const { activateNext = false } = options;
  const request = state.pendingRequests.get(requestId);
  if (!state.pendingRequests.delete(requestId)) {
    return;
  }

  const sessionKey = request?.sessionKey;
  if (sessionKey) {
    const session = state.approvalSessions.get(sessionKey);
    if (session) {
      session.queue = getQueuedRequestIds(session).filter((queuedId) => queuedId !== requestId);

      if (session.activeRequestId === requestId) {
        const nextRequestId = session.queue.find((queuedId) => state.pendingRequests.has(queuedId)) || null;
        session.activeRequestId = null;
        session.updatedAt = Date.now();

        if (activateNext && nextRequestId) {
          session.queue = session.queue.filter((queuedId) => queuedId !== nextRequestId);
          const nextRequest = state.pendingRequests.get(nextRequestId);
          if (nextRequest) {
            void openApprovalWindow({
              requestId: nextRequestId,
              requestType: nextRequest.type,
              origin: nextRequest.origin,
              tabId: nextRequest.tabId,
              reuseSession: true
            }).catch((error) => {
              console.warn('[ApprovalFlow] Failed to promote queued approval:', error);
            });
          }
        } else {
          session.queue = getQueuedRequestIds(session);
        }
      } else {
        session.updatedAt = Date.now();
      }
    }
  }

  updateKeepAlive();
}

export async function openApprovalWindow(options) {
  const {
    requestId,
    requestType,
    origin,
    tabId,
    reuseSession = false
  } = options;

  ensureWindowCleanupListener();

  const sessionKey = reuseSession ? getApprovalSessionKey(origin, tabId) : null;
  if (sessionKey) {
    const session = await ensureApprovalSessionAlive(
      sessionKey,
      state.approvalSessions.get(sessionKey)
    );

    if (session?.activeRequestId && state.pendingRequests.has(session.activeRequestId)) {
      const currentActiveRequestId = session.activeRequestId;
      const nextQueue = enqueueSessionRequest(session, requestId);
      updatePendingRequestWindow(requestId, session.windowId, session.tabId);
      setApprovalSession(sessionKey, {
        ...session,
        queue: nextQueue,
        updatedAt: Date.now()
      });
      notifyQueuedApproval(sessionKey, currentActiveRequestId, requestId, nextQueue.length);
      await chrome.windows.update(session.windowId, { focused: true }).catch(() => { });
      return {
        windowId: session.windowId,
        tabId: session.tabId,
        reused: true,
        queued: true
      };
    }

    if (session && !state.pendingRequests.has(session.activeRequestId)) {
      const nextUrl = `html/approval.html?requestId=${requestId}&type=${requestType}`;
      try {
        await chrome.tabs.update(session.tabId, { url: nextUrl });
        await chrome.windows.update(session.windowId, { focused: true }).catch(() => { });

        updatePendingRequestWindow(requestId, session.windowId, session.tabId);
        setApprovalSession(sessionKey, {
          ...session,
          activeRequestId: requestId,
          lastRequestId: requestId,
          queue: getQueuedRequestIds(session),
          updatedAt: Date.now()
        });

        return {
          windowId: session.windowId,
          tabId: session.tabId,
          reused: true
        };
      } catch (error) {
        state.approvalSessions.delete(sessionKey);
        updateKeepAlive();
      }
    }
  }

  const windowOptions = await withPopupBoundsAsync({
    url: `html/approval.html?requestId=${requestId}&type=${requestType}`,
    type: 'popup',
    width: POPUP_DIMENSIONS.width,
    height: POPUP_DIMENSIONS.height,
    focused: true
  });

  const createdWindow = await new Promise((resolve) => {
    chrome.windows.create(windowOptions, resolve);
  });

  if (!createdWindow?.id) {
    throw createInternalError('Failed to open approval window');
  }

  const createdTabId = await resolveWindowTabId(createdWindow.id);
  updatePendingRequestWindow(requestId, createdWindow.id, createdTabId);

  if (sessionKey) {
    setApprovalSession(sessionKey, {
      windowId: createdWindow.id,
      tabId: createdTabId,
      activeRequestId: requestId,
      lastRequestId: requestId,
      queue: [],
      updatedAt: Date.now()
    });
  }

  return {
    windowId: createdWindow.id,
    tabId: createdTabId,
    reused: false
  };
}
