#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function createListenerStore() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      for (const listener of [...listeners]) {
        listener(...args);
      }
    }
  };
}

function createChromeMock() {
  const windows = new Map();
  const tabs = new Map();
  const storageData = {};
  const onWindowRemoved = createListenerStore();

  let nextWindowId = 100;
  let nextTabId = 1000;

  const stats = {
    windowsCreated: 0,
    windowsFocused: 0,
    tabsUpdated: 0
  };

  const failTabUpdates = new Set();

  function serializeStorage(keys) {
    if (keys == null) {
      return { ...storageData };
    }
    if (typeof keys === 'string') {
      return { [keys]: storageData[keys] };
    }
    if (Array.isArray(keys)) {
      return keys.reduce((acc, key) => {
        acc[key] = storageData[key];
        return acc;
      }, {});
    }
    if (typeof keys === 'object') {
      return Object.keys(keys).reduce((acc, key) => {
        acc[key] = storageData[key] !== undefined ? storageData[key] : keys[key];
        return acc;
      }, {});
    }
    return {};
  }

  const chrome = {
    __stats: stats,
    __failTabUpdates: failTabUpdates,
    __windows: windows,
    __tabs: tabs,
    __reset() {
      windows.clear();
      tabs.clear();
      failTabUpdates.clear();
      Object.keys(storageData).forEach((key) => delete storageData[key]);
      nextWindowId = 100;
      nextTabId = 1000;
      stats.windowsCreated = 0;
      stats.windowsFocused = 0;
      stats.tabsUpdated = 0;
    },
    runtime: {
      id: 'test-extension-id',
      getURL(relativePath = '') {
        return `chrome-extension://test-extension-id/${relativePath}`;
      },
      async sendMessage() {
        return { success: true };
      }
    },
    storage: {
      local: {
        async get(keys) {
          return serializeStorage(keys);
        },
        async set(items) {
          Object.assign(storageData, items || {});
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach((key) => delete storageData[key]);
        },
        async clear() {
          Object.keys(storageData).forEach((key) => delete storageData[key]);
        }
      },
      onChanged: {
        addListener() {},
        removeListener() {}
      }
    },
    windows: {
      onRemoved: onWindowRemoved,
      async get(windowId) {
        const win = windows.get(windowId);
        if (!win) {
          throw new Error(`Window ${windowId} not found`);
        }
        return { ...win };
      },
      async getAll() {
        return [...windows.values()].map((win) => ({ ...win }));
      },
      async update(windowId, updates) {
        const win = windows.get(windowId);
        if (!win) {
          throw new Error(`Window ${windowId} not found`);
        }
        if (updates && updates.focused) {
          stats.windowsFocused += 1;
        }
        Object.assign(win, updates || {});
        return { ...win };
      },
      create(options, callback) {
        stats.windowsCreated += 1;
        const windowId = nextWindowId += 1;
        const tabId = nextTabId += 1;
        const tab = {
          id: tabId,
          windowId,
          url: options?.url || '',
          active: true
        };
        const win = {
          id: windowId,
          focused: Boolean(options?.focused),
          type: options?.type || 'popup',
          tabs: [tab]
        };
        windows.set(windowId, win);
        tabs.set(tabId, tab);
        callback({ ...win });
      },
      async remove(windowId) {
        const win = windows.get(windowId);
        if (!win) {
          return;
        }
        windows.delete(windowId);
        (win.tabs || []).forEach((tab) => {
          tabs.delete(tab.id);
        });
        onWindowRemoved.emit(windowId);
      }
    },
    tabs: {
      async query(queryInfo) {
        if (!queryInfo || !Number.isFinite(queryInfo.windowId)) {
          return [...tabs.values()].map((tab) => ({ ...tab }));
        }
        return [...tabs.values()]
          .filter((tab) => tab.windowId === queryInfo.windowId)
          .map((tab) => ({ ...tab }));
      },
      async update(tabId, updates) {
        stats.tabsUpdated += 1;
        if (failTabUpdates.has(tabId)) {
          throw new Error(`Tab ${tabId} update blocked`);
        }
        const tab = tabs.get(tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} not found`);
        }
        Object.assign(tab, updates || {});
        const win = windows.get(tab.windowId);
        if (win?.tabs?.length) {
          win.tabs = win.tabs.map((item) => (item.id === tabId ? { ...tab } : item));
        }
        return { ...tab };
      }
    }
  };

  return chrome;
}

function createVmContext(chrome) {
  const context = vm.createContext({
    console,
    chrome,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    structuredClone: globalThis.structuredClone,
    AbortController,
    atob: globalThis.atob,
    btoa: globalThis.btoa
  });
  context.globalThis = context;
  context.global = context;
  context.self = context;
  context.window = context;
  return context;
}

function resolveImportPath(specifier, referencingIdentifier) {
  if (!specifier.startsWith('.')) {
    throw new Error(`Unsupported import specifier: ${specifier}`);
  }
  const basePath = fileURLToPath(referencingIdentifier);
  let resolvedPath = path.resolve(path.dirname(basePath), specifier);
  if (!path.extname(resolvedPath)) {
    resolvedPath += '.js';
  }
  return resolvedPath;
}

async function loadModule(modulePath, context, moduleCache) {
  const resolvedPath = path.resolve(modulePath);
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const modulePromise = (async () => {
    const source = await fs.readFile(resolvedPath, 'utf8');
    const identifier = pathToFileURL(resolvedPath).href;
    const module = new vm.SourceTextModule(source, {
      context,
      identifier,
      initializeImportMeta(meta) {
        meta.url = identifier;
      }
    });

    await module.link(async (specifier, referencingModule) => {
      const childPath = resolveImportPath(specifier, referencingModule.identifier);
      return loadModule(childPath, context, moduleCache);
    });

    await module.evaluate();
    return module;
  })();

  moduleCache.set(resolvedPath, modulePromise);
  return modulePromise;
}

async function run() {
  const chrome = createChromeMock();
  const context = createVmContext(chrome);
  const moduleCache = new Map();

  const stateModule = await loadModule(
    path.join(repoRoot, 'js/background/state.js'),
    context,
    moduleCache
  );
  const approvalModule = await loadModule(
    path.join(repoRoot, 'js/background/approval-flow.js'),
    context,
    moduleCache
  );
  const unlockModule = await loadModule(
    path.join(repoRoot, 'js/background/unlock-flow.js'),
    context,
    moduleCache
  );

  const { state, resetState } = stateModule.namespace;
  const {
    addPendingRequest,
    removePendingRequest,
    openApprovalWindow,
    hasActiveApprovalForSession
  } = approvalModule.namespace;
  const {
    requestUnlock,
    notifyUnlocked
  } = unlockModule.namespace;

  function resetAll() {
    resetState();
    chrome.__reset();
  }

  async function waitFor(check, message, timeoutMs = 200) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (check()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(message);
  }

  async function testCreateAndReuseWindow() {
    resetAll();

    addPendingRequest('req-1', {
      type: 'connect',
      origin: 'https://app.example',
      tabId: 11,
      reuseSession: true,
      data: {}
    });

    assert.equal(
      state.pendingRequests.get('req-1').sessionKey,
      'https://app.example:11',
      'pending request should be tagged with session key'
    );

    const first = await openApprovalWindow({
      requestId: 'req-1',
      requestType: 'connect',
      origin: 'https://app.example',
      tabId: 11,
      reuseSession: true
    });

    assert.equal(first.reused, false, 'first approval should create a new popup');
    assert.equal(chrome.__stats.windowsCreated, 1, 'one popup should be created');
    assert.equal(hasActiveApprovalForSession('https://app.example', 11), true);

    const sessionAfterFirst = state.approvalSessions.get('https://app.example:11');
    assert.equal(sessionAfterFirst.activeRequestId, 'req-1');
    assert.equal(state.pendingRequests.get('req-1').windowId, first.windowId);
    assert.equal(state.pendingRequests.get('req-1').windowTabId, first.tabId);

    removePendingRequest('req-1');

    const idleSession = state.approvalSessions.get('https://app.example:11');
    assert.equal(idleSession.activeRequestId, null, 'session should become idle after response');
    assert.equal(hasActiveApprovalForSession('https://app.example', 11), false);

    addPendingRequest('req-2', {
      type: 'sign_message',
      origin: 'https://app.example',
      tabId: 11,
      reuseSession: true,
      data: {}
    });

    const reused = await openApprovalWindow({
      requestId: 'req-2',
      requestType: 'sign_message',
      origin: 'https://app.example',
      tabId: 11,
      reuseSession: true
    });

    assert.equal(reused.reused, true, 'follow-up approval should reuse the popup');
    assert.equal(chrome.__stats.windowsCreated, 1, 'reuse should not create extra popups');
    assert.equal(chrome.__stats.tabsUpdated, 1, 'reused popup should navigate existing tab');
    assert.equal(reused.windowId, first.windowId, 'reused popup should keep same window');
    assert.equal(reused.tabId, first.tabId, 'reused popup should keep same tab');
    assert.match(
      chrome.__tabs.get(first.tabId).url,
      /requestId=req-2/,
      'reused popup tab should navigate to the next approval request'
    );
  }

  async function testQueueFollowupWhileCurrentApprovalIsActive() {
    resetAll();

    addPendingRequest('req-connect', {
      type: 'connect',
      origin: 'https://queue.example',
      tabId: 44,
      reuseSession: true,
      data: {}
    });

    const first = await openApprovalWindow({
      requestId: 'req-connect',
      requestType: 'connect',
      origin: 'https://queue.example',
      tabId: 44,
      reuseSession: true
    });

    addPendingRequest('req-sign', {
      type: 'sign_message',
      origin: 'https://queue.example',
      tabId: 44,
      reuseSession: true,
      data: {}
    });

    const queued = await openApprovalWindow({
      requestId: 'req-sign',
      requestType: 'sign_message',
      origin: 'https://queue.example',
      tabId: 44,
      reuseSession: true
    });

    assert.equal(queued.reused, true, 'queued request should attach to current popup');
    assert.equal(queued.queued, true, 'queued request should be marked as queued');
    assert.equal(chrome.__stats.windowsCreated, 1, 'queued request must not create a second popup');

    const sessionBeforePromotion = state.approvalSessions.get('https://queue.example:44');
    assert.deepEqual(
      Array.from(sessionBeforePromotion.queue || []),
      ['req-sign'],
      'follow-up request should be queued'
    );
    assert.equal(sessionBeforePromotion.activeRequestId, 'req-connect', 'connect should remain active until resolved');

    removePendingRequest('req-connect', { activateNext: true });
    await waitFor(() => {
      const session = state.approvalSessions.get('https://queue.example:44');
      return session?.activeRequestId === 'req-sign';
    }, 'queued sign request was not promoted in time');

    const sessionAfterPromotion = state.approvalSessions.get('https://queue.example:44');
    assert.equal(sessionAfterPromotion.activeRequestId, 'req-sign', 'queued sign request should become active');
    assert.deepEqual(
      Array.from(sessionAfterPromotion.queue || []),
      [],
      'queue should be drained after promotion'
    );
    assert.match(
      chrome.__tabs.get(first.tabId).url,
      /requestId=req-sign/,
      'after connect resolves, popup should navigate to queued sign request'
    );
  }

  async function testFallbackToNewWindowWhenReuseFails() {
    resetAll();

    addPendingRequest('req-a', {
      type: 'connect',
      origin: 'https://fallback.example',
      tabId: 22,
      reuseSession: true,
      data: {}
    });

    const initial = await openApprovalWindow({
      requestId: 'req-a',
      requestType: 'connect',
      origin: 'https://fallback.example',
      tabId: 22,
      reuseSession: true
    });

    removePendingRequest('req-a');
    chrome.__failTabUpdates.add(initial.tabId);

    addPendingRequest('req-b', {
      type: 'sign_message',
      origin: 'https://fallback.example',
      tabId: 22,
      reuseSession: true,
      data: {}
    });

    const fallback = await openApprovalWindow({
      requestId: 'req-b',
      requestType: 'sign_message',
      origin: 'https://fallback.example',
      tabId: 22,
      reuseSession: true
    });

    assert.equal(fallback.reused, false, 'failed reuse should fall back to a new popup');
    assert.equal(chrome.__stats.windowsCreated, 2, 'fallback should create a replacement popup');
    assert.notEqual(fallback.windowId, initial.windowId, 'replacement popup should get a new window');

    const session = state.approvalSessions.get('https://fallback.example:22');
    assert.equal(session.windowId, fallback.windowId, 'session should point to replacement popup');
  }

  async function testWindowRemovalCleansSession() {
    resetAll();

    addPendingRequest('req-clean', {
      type: 'connect',
      origin: 'https://cleanup.example',
      tabId: 33,
      reuseSession: true,
      data: {}
    });

    const popup = await openApprovalWindow({
      requestId: 'req-clean',
      requestType: 'connect',
      origin: 'https://cleanup.example',
      tabId: 33,
      reuseSession: true
    });

    assert.equal(state.approvalSessions.size, 1, 'session should exist before popup closes');

    await chrome.windows.remove(popup.windowId);

    assert.equal(
      state.approvalSessions.has('https://cleanup.example:33'),
      false,
      'closing popup should clear approval session'
    );
  }

  async function testUnlockPopupIsReusedByFollowupApproval() {
    resetAll();

    const unlockPromise = requestUnlock({
      origin: 'https://locked.example',
      tabId: 55,
      method: 'eth_requestAccounts'
    });

    await waitFor(() => chrome.__stats.windowsCreated === 1, 'unlock popup was not created');

    const createdWindow = [...chrome.__windows.values()][0];
    const createdTab = createdWindow?.tabs?.[0];
    assert.ok(createdWindow, 'unlock popup should exist');
    assert.ok(createdTab, 'unlock popup should have a tab');
    assert.match(
      createdTab.url,
      /html\/approval\.html\?type=unlock/,
      'locked flow should open approval unlock step instead of popup.html'
    );

    const session = state.approvalSessions.get('https://locked.example:55');
    assert.ok(session, 'unlock flow should prime an approval session for same origin/tab');
    assert.equal(session.windowId, createdWindow.id, 'primed session should point to unlock popup');
    assert.equal(session.activeRequestId, null, 'unlock step should not consume approval request slot');

    notifyUnlocked();
    await unlockPromise;

    assert.equal(
      chrome.__windows.has(createdWindow.id),
      true,
      'unlock popup should stay open after successful unlock to continue same-window flow'
    );

    addPendingRequest('req-after-unlock', {
      type: 'connect',
      origin: 'https://locked.example',
      tabId: 55,
      reuseSession: true,
      data: {}
    });

    const reused = await openApprovalWindow({
      requestId: 'req-after-unlock',
      requestType: 'connect',
      origin: 'https://locked.example',
      tabId: 55,
      reuseSession: true
    });

    assert.equal(reused.reused, true, 'approval after unlock should reuse the unlock popup');
    assert.equal(reused.windowId, createdWindow.id, 'reused approval should keep unlock popup window');
    assert.equal(chrome.__stats.windowsCreated, 1, 'unlock + connect should still use one popup window');
    assert.match(
      chrome.__tabs.get(createdTab.id).url,
      /requestId=req-after-unlock/,
      'same unlock popup tab should transition into follow-up approval request'
    );
  }

  const tests = [
    ['create and reuse approval popup', testCreateAndReuseWindow],
    ['queue follow-up approval while current one is active', testQueueFollowupWhileCurrentApprovalIsActive],
    ['fallback to new popup when reuse fails', testFallbackToNewWindowWhenReuseFails],
    ['clear session after popup close', testWindowRemovalCleansSession],
    ['reuse unlock popup for follow-up approval', testUnlockPopupIsReusedByFollowupApproval]
  ];

  for (const [name, testFn] of tests) {
    await testFn();
    console.log(`PASS ${name}`);
  }

  console.log(`All ${tests.length} approval-flow checks passed.`);
}

run().catch((error) => {
  console.error('FAIL approval-flow regression:', error?.stack || error);
  process.exitCode = 1;
});
