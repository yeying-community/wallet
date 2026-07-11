/**
 * YeYing Wallet - 授权弹窗会话管理
 * 负责：复用同一站点/标签页的 connect + sign 审批弹窗
 */

import { createInternalError } from '../common/errors/index.js';
import { ApprovalMessageType, ApprovalPortMessageType } from '../protocol/extension-protocol.js';
import { POPUP_DIMENSIONS, TIMEOUTS } from '../config/index.js';
import { state } from './state.js';
import { updateKeepAlive } from './offscreen.js';
import { withPopupBoundsAsync } from './window-utils.js';
import { getValue, setValue } from '../storage/index.js';
import { diagnostics } from './diagnostics.js';

let windowCleanupBound = false;
let approvalStateHydrationPromise = null;
const approvalWaiters = new Map();
const approvalChannels = new Map();
const approvalTransitionWaiters = new Map();
const APPROVAL_TRANSITION_TIMEOUT_MS = 750;
const APPROVAL_STORAGE_KEYS = {
  PENDING_REQUESTS: 'approval_pending_requests',
  APPROVAL_SESSIONS: 'approval_sessions'
};

function createErrorFromPlainObject(payload, fallbackMessage = 'Approval failed') {
  const error = new Error(payload?.message || fallbackMessage);
  if (Number.isFinite(payload?.code)) {
    error.code = payload.code;
  }
  return error;
}

function serializePendingRequests() {
  return Array.from(state.pendingRequests.entries()).map(([requestId, request]) => ([
    requestId,
    {
      ...request,
      response: request?.response ? { ...request.response } : null
    }
  ]));
}

function serializeApprovalSessions() {
  return Array.from(state.approvalSessions.entries()).map(([sessionKey, session]) => ([
    sessionKey,
    {
      ...session,
      queue: getQueuedRequestIds(session)
    }
  ]));
}

function persistApprovalState() {
  const payload = {
    [APPROVAL_STORAGE_KEYS.PENDING_REQUESTS]: serializePendingRequests(),
    [APPROVAL_STORAGE_KEYS.APPROVAL_SESSIONS]: serializeApprovalSessions()
  };
  setValue(APPROVAL_STORAGE_KEYS.PENDING_REQUESTS, payload[APPROVAL_STORAGE_KEYS.PENDING_REQUESTS]).catch((error) => {
    console.warn('[ApprovalFlow] Failed to persist pending requests:', error);
  });
  setValue(APPROVAL_STORAGE_KEYS.APPROVAL_SESSIONS, payload[APPROVAL_STORAGE_KEYS.APPROVAL_SESSIONS]).catch((error) => {
    console.warn('[ApprovalFlow] Failed to persist approval sessions:', error);
  });
}

function updateApprovalState() {
  updateKeepAlive();
  persistApprovalState();
}

function clearApprovalWaiters(requestId, settle) {
  const waiters = approvalWaiters.get(requestId);
  if (!waiters?.length) return;
  approvalWaiters.delete(requestId);
  waiters.forEach((waiter) => {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    settle(waiter);
  });
}

function resolveApprovalWaiters(requestId, response) {
  clearApprovalWaiters(requestId, (waiter) => waiter.resolve(response));
}

function rejectApprovalWaiters(requestId, error) {
  clearApprovalWaiters(requestId, (waiter) => waiter.reject(error));
}

function updatePendingRequestWindow(requestId, windowId, tabId) {
  const pendingRequest = state.pendingRequests.get(requestId);
  if (!pendingRequest) return;
  pendingRequest.windowId = windowId;
  pendingRequest.windowTabId = tabId;
  updateApprovalState();
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
    const removedRequestIds = [];
    for (const [requestId, request] of state.pendingRequests.entries()) {
      if (request?.windowId !== windowId) continue;
      removedRequestIds.push(requestId);
    }
    removedRequestIds.forEach((requestId) => {
      removePendingRequest(requestId, {
        error: createErrorFromPlainObject(
          { message: 'User closed approval window', code: 4001 },
          'User closed approval window'
        )
      });
      changed = true;
    });
    if (changed) {
      updateApprovalState();
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
    updateApprovalState();
    return null;
  }

  try {
    await chrome.windows.get(session.windowId);
  } catch (error) {
    state.approvalSessions.delete(sessionKey);
    updateApprovalState();
    return null;
  }

  const nextTabId = Number.isFinite(session.tabId)
    ? session.tabId
    : await resolveWindowTabId(session.windowId);

  if (!Number.isFinite(nextTabId)) {
    state.approvalSessions.delete(sessionKey);
    updateApprovalState();
    return null;
  }

  if (session.tabId !== nextTabId) {
    session.tabId = nextTabId;
    updateApprovalState();
  }

  return session;
}

function setApprovalSession(sessionKey, value) {
  if (!sessionKey) return;
  state.approvalSessions.set(sessionKey, value);
  updateApprovalState();
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

function settleApprovalTransition(transitionId, success, port = null) {
  const waiter = approvalTransitionWaiters.get(transitionId);
  if (!waiter) return;
  if (port && waiter.port !== port) return;
  approvalTransitionWaiters.delete(transitionId);
  clearTimeout(waiter.timer);
  waiter.resolve(Boolean(success));
}

function settleApprovalTransitionsForPort(port) {
  approvalTransitionWaiters.forEach((waiter, transitionId) => {
    if (waiter.port === port) settleApprovalTransition(transitionId, false, port);
  });
}

export function registerApprovalChannel(port) {
  const tabId = port?.sender?.tab?.id;
  const senderUrl = String(port?.sender?.url || '');
  const approvalUrl = chrome.runtime.getURL('html/approval.html');
  let isApprovalPage = false;
  try {
    const sender = new URL(senderUrl);
    const approval = new URL(approvalUrl);
    isApprovalPage = sender.origin === approval.origin && sender.pathname === approval.pathname;
  } catch (error) {
    isApprovalPage = false;
  }
  if (!Number.isFinite(tabId) || !isApprovalPage) {
    port?.disconnect?.();
    return false;
  }

  const previous = approvalChannels.get(tabId)?.port;
  if (previous && previous !== port) {
    try { previous.disconnect(); } catch (error) { /* replaced channel */ }
  }
  const channel = { port, ready: false };
  approvalChannels.set(tabId, channel);

  port.onMessage.addListener((message) => {
    if (message?.type === ApprovalPortMessageType.READY) {
      channel.ready = true;
      return;
    }
    if (message?.type === ApprovalPortMessageType.ACTIVATE_RESULT) {
      settleApprovalTransition(message.transitionId, message.success, port);
    }
  });
  port.onDisconnect.addListener(() => {
    settleApprovalTransitionsForPort(port);
    if (approvalChannels.get(tabId)?.port === port) {
      approvalChannels.delete(tabId);
    }
  });
  return true;
}

async function notifyApprovalRequestActivated(session, requestId, requestType) {
  const channel = approvalChannels.get(session?.tabId);
  if (!channel?.ready) return false;
  const { port } = channel;

  const transitionId = `${requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const resultPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      approvalTransitionWaiters.delete(transitionId);
      resolve(false);
    }, APPROVAL_TRANSITION_TIMEOUT_MS);
    approvalTransitionWaiters.set(transitionId, { resolve, timer, port });
  });

  try {
    port.postMessage({
      type: ApprovalPortMessageType.ACTIVATE_REQUEST,
      transitionId,
      requestId,
      requestType
    });
  } catch (error) {
    settleApprovalTransition(transitionId, false, port);
  }
  return resultPromise;
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

  updateApprovalState();
}

export function removePendingRequest(requestId, options = {}) {
  const { activateNext = false, error = null } = options;
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

  if (error) {
    rejectApprovalWaiters(requestId, error);
  }

  updateApprovalState();
}

export async function ensureApprovalStateHydrated(options = {}) {
  const { force = false } = options;
  if (force) {
    approvalStateHydrationPromise = null;
  }
  if (approvalStateHydrationPromise) {
    return approvalStateHydrationPromise;
  }

  approvalStateHydrationPromise = (async () => {
    ensureWindowCleanupListener();

    const [pendingEntries, sessionEntries] = await Promise.all([
      getValue(APPROVAL_STORAGE_KEYS.PENDING_REQUESTS, []),
      getValue(APPROVAL_STORAGE_KEYS.APPROVAL_SESSIONS, [])
    ]);

    state.pendingRequests.clear();
    state.approvalSessions.clear();

    const now = Date.now();
    for (const entry of Array.isArray(pendingEntries) ? pendingEntries : []) {
      const [requestId, request] = Array.isArray(entry) ? entry : [];
      if (!requestId || !request) continue;
      const expiresAt = Number.isFinite(request.expiresAt)
        ? request.expiresAt
        : (Number.isFinite(request.timestamp) ? request.timestamp + TIMEOUTS.REQUEST : now + TIMEOUTS.REQUEST);
      if (expiresAt <= now) {
        continue;
      }
      state.pendingRequests.set(requestId, {
        ...request,
        expiresAt
      });
    }

    for (const entry of Array.isArray(sessionEntries) ? sessionEntries : []) {
      const [sessionKey, session] = Array.isArray(entry) ? entry : [];
      if (!sessionKey || !session) continue;
      state.approvalSessions.set(sessionKey, {
        ...session,
        queue: getQueuedRequestIds(session)
      });
    }

    for (const [sessionKey, session] of [...state.approvalSessions.entries()]) {
      await ensureApprovalSessionAlive(sessionKey, session);
    }

    for (const [requestId, request] of [...state.pendingRequests.entries()]) {
      const session = request?.sessionKey ? state.approvalSessions.get(request.sessionKey) : null;
      if (session?.windowId) {
        request.windowId = session.windowId;
        request.windowTabId = session.tabId;
        continue;
      }

      if (!Number.isFinite(request?.windowId)) {
        request.windowId = null;
        request.windowTabId = null;
        continue;
      }

      try {
        await chrome.windows.get(request.windowId);
      } catch (error) {
        request.windowId = null;
        request.windowTabId = null;
      }
    }

    updateApprovalState();
  })();

  return approvalStateHydrationPromise;
}

export function getClientRequestKey(origin, tabId, method, clientRequestId) {
  const normalizedOrigin = origin || 'unknown';
  const normalizedTabId = Number.isFinite(tabId) ? tabId : 'none';
  const normalizedMethod = method || 'unknown';
  const normalizedClientRequestId = clientRequestId || 'none';
  return `${normalizedOrigin}:${normalizedTabId}:${normalizedMethod}:${normalizedClientRequestId}`;
}

export function findPendingRequestByClientKey(clientRequestKey) {
  if (!clientRequestKey) return null;
  for (const [requestId, request] of state.pendingRequests.entries()) {
    if (request?.clientRequestKey !== clientRequestKey) continue;
    return { requestId, request };
  }
  return null;
}

export async function ensureApprovalRequestVisible(requestId, fallback = {}) {
  const request = state.pendingRequests.get(requestId);
  if (!request) {
    return null;
  }

  if (request.response) {
    return request;
  }

  if (Number.isFinite(request.windowId)) {
    try {
      await chrome.windows.update(request.windowId, { focused: true });
      return request;
    } catch (error) {
      request.windowId = null;
      request.windowTabId = null;
    }
  }

  await openApprovalWindow({
    requestId,
    requestType: fallback.requestType || request.approvalType || request.type,
    origin: fallback.origin || request.origin,
    tabId: Number.isFinite(fallback.tabId) ? fallback.tabId : request.tabId,
    reuseSession: fallback.reuseSession ?? Boolean(request.reuseSession)
  });

  return state.pendingRequests.get(requestId) || null;
}

export function recordApprovalResponse(requestId, response) {
  const request = state.pendingRequests.get(requestId);
  if (!request) {
    return false;
  }

  request.response = {
    approved: Boolean(response?.approved),
    account: response?.account || null,
    submittedAt: Date.now()
  };
  diagnostics.record({
    category: 'approval',
    action: request.response.approved ? 'approved' : 'rejected',
    message: `${request.approvalType || request.type || 'approval'} ${request.response.approved ? 'approved' : 'rejected'}`,
    meta: { type: request.approvalType || request.type || '', origin: request.origin || '' }
  });
  updateApprovalState();
  resolveApprovalWaiters(requestId, request.response);
  return true;
}

export function waitForApprovalResponse(requestId, options = {}) {
  const request = state.pendingRequests.get(requestId);
  if (!request) {
    return Promise.reject(new Error('Approval request not found'));
  }
  if (request.response) {
    return Promise.resolve(request.response);
  }

  const now = Date.now();
  const expiresAt = Number.isFinite(request.expiresAt)
    ? request.expiresAt
    : (Number.isFinite(request.timestamp) ? request.timestamp + TIMEOUTS.REQUEST : now + TIMEOUTS.REQUEST);
  request.expiresAt = expiresAt;
  updateApprovalState();

  const timeoutMs = Math.max(0, expiresAt - now);
  if (timeoutMs === 0) {
    const error = createErrorFromPlainObject({ message: 'Approval request timeout', code: -32005 }, 'Approval request timeout');
    removePendingRequest(requestId, { error });
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = createErrorFromPlainObject(
        { message: 'Approval request timeout', code: -32005 },
        'Approval request timeout'
      );
      const activeRequest = state.pendingRequests.get(requestId);
      if (!activeRequest || activeRequest.response) {
        return;
      }
      if (Number.isFinite(activeRequest.windowId)) {
        chrome.windows.remove(activeRequest.windowId).catch(() => { });
      }
      removePendingRequest(requestId, { error: timeoutError });
    }, timeoutMs);

    const waiters = approvalWaiters.get(requestId) || [];
    waiters.push({ resolve, reject, timer });
    approvalWaiters.set(requestId, waiters);
  });
}

export function getPendingRequestById(requestId) {
  return state.pendingRequests.get(requestId) || null;
}

export function getActiveApprovalSummary() {
  let selected = null;

  for (const [requestId, request] of state.pendingRequests.entries()) {
    if (request?.response) continue;
    const session = request?.sessionKey ? state.approvalSessions.get(request.sessionKey) : null;
    const updatedAt = session?.updatedAt || request?.timestamp || 0;
    if (!selected || updatedAt > selected.updatedAt) {
      selected = {
        requestId,
        requestType: request.approvalType || request.type,
        origin: request.origin || '',
        tabId: request.tabId,
        windowId: session?.windowId || request.windowId || null,
        sessionKey: request.sessionKey || null,
        updatedAt
      };
    }
  }

  return selected;
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
      try {
        await chrome.windows.update(session.windowId, { focused: true }).catch(() => { });

        updatePendingRequestWindow(requestId, session.windowId, session.tabId);
        setApprovalSession(sessionKey, {
          ...session,
          activeRequestId: requestId,
          lastRequestId: requestId,
          queue: getQueuedRequestIds(session),
          updatedAt: Date.now()
        });

        const delivered = await notifyApprovalRequestActivated(session, requestId, requestType);
        if (!delivered) {
          await chrome.tabs.update(session.tabId, {
            url: `html/approval.html?requestId=${requestId}&type=${requestType}`
          });
        }

        return {
          windowId: session.windowId,
          tabId: session.tabId,
          reused: true,
          activatedInPage: delivered
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
