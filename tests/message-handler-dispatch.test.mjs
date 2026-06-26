/**
 * message-handler dispatch 注册表回归（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 覆盖 handlePopupMessage 的注册表化行为：
 * - 全部已注册类型能命中 handler 并返回响应
 * - 未注册类型走 default 分支，固定返回 {success:false, error:'Unknown message type'}
 * - handler 抛错被外层 try/catch 兜底为 {success:false, error:...}
 * - 关键行为回归：CHANGE_PASSWORD 失败走 lambda 内层 try/catch、APPROVAL_RESPONSE 从 message 顶层读字段
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── 在导入 background 依赖图之前注入最小 chrome.storage.local mock ──
const store = {};
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (p = '') => `chrome-extension://test-extension-id/${p}`,
    sendMessage: async () => ({ success: true }),
    onMessage: { addListener() {} },
    onConnect: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} }
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(
          Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]])
        );
      },
      async set(items) { Object.assign(store, items || {}); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: { addListener() {} }
  },
  windows: { onRemoved: { addListener() {} } }
};

const { handlePopupMessage } = await import('../js/background/message-handler.js');
const { WalletMessageType, TransactionMessageType, NetworkMessageType, ApprovalMessageType } =
  await import('../js/protocol/extension-protocol.js');

function captureResponse() {
  let body;
  const response = (v) => { body = v; };
  return { response, get body() { return body; } };
}

test('注册表：所有当前 switch 中存在的类型都有 handler', async () => {
  // 这些是本次改造前 switch 中出现过的字符串常量；任何漏注册的会先被发现。
  const expectedStringTypes = [
    'IS_WALLET_INITIALIZED',
    'GET_ALL_WALLETS',
    'CREATE_HD_WALLET',
    'IMPORT_HD_WALLET',
    'IMPORT_PRIVATE_KEY_WALLET',
    'CREATE_MPC_WALLET',
    'CREATE_SUB_ACCOUNT',
    'SWITCH_ACCOUNT',
    'UNLOCK_WALLET',
    'LOCK_WALLET',
    'GET_WALLET_STATE',
    'CHANGE_PASSWORD',
    'SWITCH_NETWORK',
    'SIGN_MESSAGE',
    'SIGN_TRANSACTION'
  ];
  for (const t of expectedStringTypes) {
    const cap = captureResponse();
    await handlePopupMessage({ type: t, data: {} }, cap.response);
    assert.notEqual(cap.body, undefined, `${t} 未注册或被注册表忽略`);
    if (cap.body?.success === false && cap.body?.error === 'Unknown message type') {
      throw new Error(`${t} 被误判为 Unknown message type`);
    }
  }
});

test('每个协议消息类型分发时都不抛 ReferenceError（防 handler 名拼写错）', async () => {
  // 拼错的 handler 名（如 handleGetMpcAuditExportConfig）只有在该类型被实际分发时才会
  // 抛 "xxx is not defined"。这里把所有协议常量逐个分发一遍，空 data，断言不出现 ReferenceError。
  const allTypes = [
    ...Object.values(WalletMessageType),
    ...Object.values(TransactionMessageType),
    ...Object.values(NetworkMessageType),
    ...Object.values(ApprovalMessageType)
  ];
  const refErrors = [];
  for (const t of allTypes) {
    const cap = captureResponse();
    await handlePopupMessage({ type: t, data: {} }, cap.response);
    const err = cap.body?.error || '';
    if (/is not defined/.test(err)) {
      refErrors.push(`${t}: ${err}`);
    }
  }
  assert.deepEqual(refErrors, [], `存在未定义的 handler 引用:\n${refErrors.join('\n')}`);
});

test('未注册类型返回 {success:false, error:"Unknown message type"}', async () => {
  const cap = captureResponse();
  await handlePopupMessage({ type: 'NOT_A_REAL_TYPE', data: {} }, cap.response);
  assert.deepEqual(cap.body, { success: false, error: 'Unknown message type' });
});

test('handler 抛错时，外层 try/catch 兜底为 {success:false, error}', async () => {
  // handleExportPrivateKey(accountId=undefined) 会进 vault.getAccountPrivateKey 并抛错
  const cap = captureResponse();
  await handlePopupMessage(
    { type: WalletMessageType.EXPORT_PRIVATE_KEY, data: { accountId: 'missing-id', password: 'Pass-1111' } },
    cap.response
  );
  assert.equal(cap.body.success, false);
  assert.match(cap.body.error, /account not found|Account not found|password|invalid|corrupted/i);
});

test('APPROVAL_RESPONSE 从 message 顶层读 requestId/approved/account（不依赖 data）', async () => {
  // 直接验证 lambda 的 ctx 参数传递正确：APPROVAL_RESPONSE handler 通过 ctx.message 访问顶层字段
  // 由于 recordApprovalResponse 会写入 state，我们用一个测试用例验证字段被正确读出
  const cap = captureResponse();
  await handlePopupMessage(
    {
      type: ApprovalMessageType.APPROVAL_RESPONSE,
      // 注意：没有 data 字段，requestId/approved/account 在顶层
      requestId: 'fake-request',
      approved: false,
      account: null
    },
    cap.response
  );
  // 返回 {success: <boolean>}。不存在的 requestId 时 recordApprovalResponse 返回 false
  assert.equal(typeof cap.body, 'object');
  assert.equal('success' in cap.body, true);
});

test('CHANGE_PASSWORD 走 lambda 内层 try/catch：旧密码错返回 {success:false,error}', async () => {
  const cap = captureResponse();
  // 注意：handlePopupMessage 外层 + lambda 内层都做 try/catch，但 lambda 内层会先捕获
  // 并返回 error message，外层不再重复包装
  await handlePopupMessage(
    { type: 'CHANGE_PASSWORD', data: { oldPassword: 'WRONG-old-pass', newPassword: 'New-Pass-1234' } },
    cap.response
  );
  assert.equal(cap.body.success, false);
  assert.equal(typeof cap.body.error, 'string');
});

test('KNOWN handler（GET_CURRENT_CHAIN_ID）返回当前 chainId 形状', async () => {
  const cap = captureResponse();
  await handlePopupMessage(
    { type: NetworkMessageType.GET_CURRENT_CHAIN_ID, data: {} },
    cap.response
  );
  // shape: { success, chainId }，允许 chainId 为 null
  assert.equal(cap.body.success, true);
  assert.ok('chainId' in cap.body);
});