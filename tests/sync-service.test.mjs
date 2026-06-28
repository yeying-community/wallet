/**
 * sync-service 集成测试（mock fetch + storage + fake-indexeddb）
 * 运行：npm test 或 node --test --test-force-exit "tests/sync-service.test.mjs"
 *
 * 覆盖：payload 构建（accounts/contacts/networkIds）/ WebDAV 请求（GET/PUT/HEAD/DELETE）
 * / remote-meta ETag 缓存 / syncAll 拉取合并 / onUnlocked/onLocked / 活动日志。
 *
 * sync-service.js 在导入时同步调用 chrome.runtime?.id 拿 app id —— 所以 chrome mock
 * 必须在 dynamic import 之前就位；fake-indexeddb/auto 也要先 polyfill。
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 让 fake-indexeddb 在 sync-service 依赖图加载前已挂全局 IDB
import 'fake-indexeddb/auto';

// ── chrome mock：覆盖所有 sync-service 间接访问的 chrome.* ──
const store = {};
const listenerStore = new Set();

globalThis.chrome = {
  runtime: {
    id: 'test-extension-id-abcdefghijklmnopqrstuvwxyz',
    getURL: (p = '') => `chrome-extension://test/${p}`,
    sendMessage: async () => ({ success: true })
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]]));
      },
      async set(items) { Object.assign(store, items || {}); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: {
      addListener(cb) { listenerStore.add(cb); },
      removeListener(cb) { listenerStore.delete(cb); }
    }
  },
  windows: { onRemoved: { addListener() {} } },
  tabs: { query: async () => [] }
};

// ── fetch mock：可控响应队列 ──
const fetchCalls = [];
const fetchResponses = []; // { status, body, headers } | 'reject' | null(默认值)

globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), method: options.method || 'GET', body: options.body });
  const next = fetchResponses.shift();
  // 默认（未排队）= 404：让 sync-service 走"远端不存在"路径，避免污染其它用例。
  if (next === undefined) {
    return {
      ok: false,
      status: 404,
      headers: new Map(),
      statusText: 'Not Found',
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0)
    };
  }
  if (next === 'reject') {
    throw new Error('fetch-mock: rejected');
  }
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    headers: new Map(Object.entries(next.headers || {})),
    statusText: '',
    text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    json: async () => (typeof next.body === 'string' ? JSON.parse(next.body) : next.body),
    arrayBuffer: async () => {
      const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
      return new TextEncoder().encode(text).buffer;
    }
  };
};
globalThis.fetchCalls = fetchCalls;
globalThis.fetchResponses = fetchResponses;

// ── sync-service 依赖的 setInterval 必须存在且被拦截：sync-service 用 setTimeout（非
//    setInterval），但 background-graph 间接引入了 mpcService 等单例；这里只 import
//    sync-service 本身，避免拉入 mpcService 的 keep-alive 定时器。──

// mock password cache（sync-service 用 getCachedPassword 派生 syncKey/fingerprint）
const passwordCacheStore = { value: null };
globalThis.__setCachedPassword = (pwd) => { passwordCacheStore.value = pwd; };
globalThis.__clearCachedPassword = () => { passwordCacheStore.value = null; };

// ── sync-service 间接依赖的 password-cache.js 必须在 sync-service 之前可替换。
//    简单做法：用一个 mock 文件覆盖 import — 但 node ESM 不支持运行时替换。
//    替代方案：直接为测试用真实 password-cache 实现（chrome.storage mock 即可），
//    在 beforeEach 写入 passwordCache 键并触发 initPasswordCache 时机。
//    然而 init 不会自动调；我们在 onUnlocked 之前 setValue。
//
//    实际更简单：password-cache 内部用 getUserSetting/setUserSetting，键为 'walletPassword'。
//    我们在 seedUserSettings 里写即可。

// ==================== 工具：seed 状态 ====================

const SETTINGS = {
  endpoint: 'backupSyncEndpoint',
  authMode: 'backupSyncAuthMode',
  authToken: 'backupSyncAuthToken',
  authTokenExpiresAt: 'backupSyncAuthTokenExpiresAt',
  ucanToken: 'backupSyncUcanToken',
  ucanResource: 'backupSyncUcanResource',
  ucanAction: 'backupSyncUcanAction',
  ucanAudience: 'backupSyncUcanAudience',
  basicAuth: 'backupSyncBasicAuth',
  dirty: 'backupSyncDirty',
  lastPullAt: 'backupSyncLastPullAt',
  lastPushAt: 'backupSyncLastPushAt',
  pendingDelete: 'backupSyncPendingDelete',
  networkIds: 'backupSyncNetworkIds',
  conflicts: 'backupSyncConflicts',
  remoteMeta: 'backupSyncRemoteMeta',
  logs: 'backupSyncLogs',
  logMaxCount: 'backupSyncLogMaxCount',
  logRetentionDays: 'backupSyncLogRetentionDays',
  enabled: 'backupSyncEnabled'
};

async function seedUserSettings(overrides = {}) {
  const base = {
    [SETTINGS.endpoint]: 'https://test.webdav.example/dav',
    [SETTINGS.authMode]: 'ucan',
    [SETTINGS.ucanToken]: 'test-token-1234567890',
    [SETTINGS.ucanResource]: 'app:test-app-id',
    [SETTINGS.ucanAction]: 'write',
    [SETTINGS.enabled]: true,
    [SETTINGS.dirty]: false,
    [SETTINGS.remoteMeta]: {},
    [SETTINGS.logs]: [],
    [SETTINGS.logMaxCount]: 100000,
    [SETTINGS.logRetentionDays]: 30,
    [SETTINGS.conflicts]: [],
    [SETTINGS.pendingDelete]: false,
    walletPassword: 'TestPassword123' // password-cache 读取这个键
  };
  await globalThis.chrome.storage.local.set({ user_settings: { ...base, ...overrides } });
}

// 种子 wallet / account / network / contact —— 通过 storage API，
// 确保 sync-service 走的是真实存储路径（chrome 后端，默认；测试用 IDB 仍可，但同步 payload
// 不读它们 —— sync-service 直接 getWallets/getWalletAccounts/getNetworks/getContactList）。
async function seedDomainData() {
  const ops = await import('../js/storage/index.js');
  const { encryptString } = await import('../js/common/crypto/index.js');
  const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
  const PASSWORD = 'TestPassword123';
  const encryptedMnemonic = await encryptString(TEST_MNEMONIC, PASSWORD);

  await ops.clearAllData();

  await ops.saveWallet({ id: 'w1', name: 'HD Wallet', type: 'hd', accountCount: 1, createdAt: 1, encryptedMnemonic });
  await ops.saveAccount({
    id: 'w1_0', walletId: 'w1', name: 'Account 1', type: 'main', index: 0,
    address: '0x1111111111111111111111111111111111111111',
    encryptedPrivateKey: 'encA', createdAt: 1, nameUpdatedAt: 1000
  });
  await ops.saveNetworks([{ chainId: '0x1', name: 'Ethereum' }]);
  await ops.saveContact({ id: 'c1', name: 'Alice', address: '0x2222222222222222222222222222222222222222', updatedAt: 1000 });
}

// ==================== 测试 ====================

let syncModule; // lazy — 在 beforeEach 内动态 import，避免模块顶层就触达 fake-indexeddb 连接
let backupSyncService;
let ops;
beforeEach(async () => {
  if (!syncModule) {
    syncModule = await import('../js/background/sync-service.js');
    backupSyncService = syncModule.backupSyncService;
    ops = await import('../js/storage/index.js');
  }
  // 清 IDB + chrome.storage + fetch 队列 + 监听器
  await ops.clearAllData();
  Object.keys(store).forEach((k) => delete store[k]);
  listenerStore.clear();
  fetchCalls.length = 0;
  fetchResponses.length = 0;
  // 保险：停掉上一例遗留的 setTimeout（autoSync / debouncePush），否则事件循环挂起
  if (backupSyncService._autoSyncTimer) {
    clearTimeout(backupSyncService._autoSyncTimer);
  }
  if (backupSyncService._debounceTimer) {
    clearTimeout(backupSyncService._debounceTimer);
  }
  // 重置 singleton 内部状态（构造函数字段也重置）
  await backupSyncService.onLocked().catch(() => {}); // 保险：停定时器（onLocked 不依赖网络，除非 pushAll 内部）
  backupSyncService._initialized = false;
  backupSyncService._contexts = new Map();
  backupSyncService._syncInFlight = false;
  backupSyncService._dirty = false;
  backupSyncService._debounceTimer = null;
  backupSyncService._suppressStorageEvents = false;
  backupSyncService._autoSyncTimer = null;
  backupSyncService._autoSyncFailures = 0;
  backupSyncService._remoteMeta = {}; // ← 关键：上一例 ETag 缓存会污染本例
  backupSyncService._activityLogs = [];
  // 清 listenerStore 中的回调（init 会重新注册）
  listenerStore.clear();
  await seedUserSettings();
  await seedDomainData();
  await backupSyncService.init();
});

// ── 初始化 + onUnlocked 派生 context ──

test('init() 加载设置、注册存储监听器；_prepareContexts 派生 fingerprint+syncKey', async () => {
  // 直接调内部 _prepareContexts —— onUnlocked 内部还走 syncAll（写路径），下面用例单独覆盖
  await backupSyncService._prepareContexts('TestPassword123');
  const contexts = backupSyncService._contexts;
  assert.equal(contexts.size, 1, '一个 HD 钱包 → 一个 context');
  assert.ok(contexts.get('w1').fingerprint.length > 0);
  assert.ok(contexts.get('w1').syncKey.length > 0, 'syncKey 应为派生 hex 字符串');
});

// ── 拉取：远端空 → 不更新本地；远端有 → 应用 payload ──

test('pullRemote 远端空 → 本地不变', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  fetchResponses.length = 0;
  // HEAD + GET 都返回 404（默认 fetch 行为）。syncAll 会随后 push（MKCOL 也 404）
  // 因此错误是预期的 —— 用 try/catch 吞掉避免变成 unhandled rejection 影响其它用例。
  await backupSyncService.syncAll('manual').catch((e) => {
    assert.match(String(e?.message || e), /MKCOL/);
  });
  const after = await ops.getAccountList();
  assert.equal(after.length, 1, '远端空不修改本地账户');
});

// _pullRemote 是高度复合的 HEAD+GET+解密+push 链路（push 走 MKCOL+PUT 涉及
// _ensureDirectory），单独验 _buildPayload 产出 + _applyRemotePayload 合并即可覆盖关键路径。
test('_buildPayload 正确产出 accounts/contacts/networkIds', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  const payload = await backupSyncService._buildPayload('w1', 'manual');
  assert.equal(payload.version, 1);
  assert.equal(payload.accountCount, 1);
  assert.equal(payload.accounts.length, 1);
  assert.equal(payload.accounts[0].address, '0x1111111111111111111111111111111111111111');
  assert.equal(payload.contacts.length, 1);
  assert.deepEqual(payload.networkIds, ['0x1']);
});

test('_applyRemotePayload 按 LWW 合并账户（远端 nameUpdatedAt 更新则覆盖）', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  // password-cache 模块用 state.passwordCache（内存），不是 chrome.storage；需手动设
  const stateModule = await import('../js/background/state.js');
  stateModule.state.passwordCache = 'TestPassword123';

  const remotePayload = {
    version: 1,
    updatedAt: Date.now(),
    reason: 'remote',
    accountCount: 2,
    accounts: [
      { index: 0, address: '0x1111111111111111111111111111111111111111', name: 'Renamed by remote', nameUpdatedAt: 9999 },
      { index: 1, address: '0x3333333333333333333333333333333333333333', name: 'New from remote', nameUpdatedAt: 9999 }
    ],
    contacts: [],
    networkIds: ['0x1']
  };

  await backupSyncService._applyRemotePayload('w1', remotePayload, 'manual');
  const merged = await ops.getWalletAccounts('w1');
  assert.equal(merged.length, 2);
  const acc0 = merged.find((a) => a.index === 0);
  assert.equal(acc0.name, 'Renamed by remote', 'LWW 应采纳远端名');
  const acc1 = merged.find((a) => a.index === 1);
  assert.equal(acc1.name, 'New from remote');
});

// ── 推送：dirty 标记后 PUT 远端 ──

test('pushAll 走 PUT，body 是带 cipher 的 JSON envelope', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  fetchResponses.length = 0;
  // MKCOL 可能被触发（status 405/409 视同成功）；PUT 返回 200
  fetchResponses.push({ status: 405, headers: {} }); // MKCOL 已存在
  fetchResponses.push({ status: 200, headers: { ETag: '"new-etag"' } });

  backupSyncService.markDirty('test-dirty');
  await backupSyncService.pushAll('manual');

  const putCall = fetchCalls.find((c) => c.method === 'PUT');
  assert.ok(putCall, '应发出 PUT 请求');
  assert.match(putCall.url, /payload\..+\.json\.enc$/, 'URL 含 fingerprint + payload.json.enc');
  const envelope = JSON.parse(putCall.body);
  assert.ok(envelope.cipher, 'envelope 含 cipher');
  assert.ok(envelope.kdf, 'envelope 含 kdf 元数据');
});

// ── ETag 缓存避免重复拉取 ──

test('远端 ETag 与缓存一致 → 跳过 GET', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  // _remoteMeta 按 fingerprint 索引而非 walletId
  const fingerprint = backupSyncService._contexts.get('w1').fingerprint;
  const sharedEtag = '"shared-etag-value"';
  backupSyncService._remoteMeta[fingerprint] = { etag: sharedEtag, lastChecked: Date.now() };

  fetchResponses.length = 0;
  fetchResponses.push({ status: 200, headers: { ETag: sharedEtag } });

  const ctx = backupSyncService._contexts.get('w1');
  const shouldPull = await backupSyncService._shouldPullRemote(ctx);
  assert.equal(shouldPull, false, 'ETag 命中应跳过拉取');
});

// ── onLocked 停自动同步并清 context ──

test('onLocked 停止自动同步并清空 _contexts', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  assert.equal(backupSyncService._contexts.size, 1);
  assert.equal(backupSyncService._autoSyncTimer, null, 'init 未启动 autoSync 时 timer 为 null');

  // 屏蔽 onLocked 内部的 pushAll 网络：临时把 _syncInFlight 置 true，pushAll 早返
  backupSyncService._syncInFlight = true;
  await backupSyncService.tryStartAutoSync();
  assert.notEqual(backupSyncService._autoSyncTimer, null, 'tryStartAutoSync 后 timer 应非空');
  backupSyncService._syncInFlight = false;

  await backupSyncService.onLocked();
  assert.equal(backupSyncService._autoSyncTimer, null, 'onLocked 应停 autoSync');
  assert.equal(backupSyncService._contexts.size, 0, 'onLocked 应清空 _contexts');
});

// ── 活动日志：pushAll 后产生 push 成功条目 ──

test('pushAll 成功后写入活动日志（action=push）', async () => {
  await backupSyncService._prepareContexts('TestPassword123');
  fetchResponses.length = 0;
  fetchResponses.push({ status: 405, headers: {} }); // MKCOL
  fetchResponses.push({ status: 200, headers: { ETag: '"x"' } }); // PUT

  backupSyncService.markDirty('test');
  await backupSyncService.pushAll('manual');

  const logs = backupSyncService._activityLogs;
  // _pushWallet 写 action='push' / reason='manual'（durationMs 仅 syncAll 写）
  const pushLog = logs.find((l) => l.action === 'push' && l.reason === 'manual');
  assert.ok(pushLog, '应写入 action=push / reason=manual 的日志');
  assert.match(pushLog.message, /推送/);
});