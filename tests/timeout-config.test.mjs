/**
 * config/timeout-config 纯函数单测（含异步、零 DOM）
 * 运行：npm test
 *
 * 超时/重试/重连/轮询/防抖节流：交易/解锁/审批超时判断错会卡住或放弃过早；
 * 重试 backoff 错会雪崩；防抖节流错会让 UI 频繁刷新。
 *
 * 含几条防回归断言（★ 标注）：记录"未按 attempt 限制的退避增长"等微妙行为，
 * 避免未来误改 backoff 公式。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMEOUTS,
  RECONNECT_CONFIG,
  RETRY_CONFIG,
  POLLING_CONFIG,
  CACHE_CONFIG,
  getTimeout,
  calculateReconnectDelay,
  calculateRetryDelay,
  shouldRetry,
  withTimeout,
  withRetry,
  createPoller,
  debounce,
  throttle
} from '../js/config/timeout-config.js';

// ==================== getTimeout ====================

test('getTimeout：大小写不敏感、未知类型回落 REQUEST', () => {
  assert.equal(getTimeout('REQUEST'), TIMEOUTS.REQUEST);
  assert.equal(getTimeout('request'), TIMEOUTS.REQUEST, '小写');
  assert.equal(getTimeout('Transaction'), TIMEOUTS.TRANSACTION, '混合大小写');
  assert.equal(getTimeout('UNLOCK'), TIMEOUTS.UNLOCK);
  assert.equal(getTimeout('unknown-type'), TIMEOUTS.REQUEST);
});

test('getTimeout：必要超时档都有正值', () => {
  for (const [k, v] of Object.entries(TIMEOUTS)) {
    assert.ok(v > 0, `${k} 应 > 0`);
  }
});

// ==================== calculateReconnectDelay / calculateRetryDelay ====================

test('calculateReconnectDelay：指数 backoff，到 MAX_DELAY 截断', () => {
  // INITIAL=1000, BACKOFF_MULTIPLIER=2, MAX=5000
  assert.equal(calculateReconnectDelay(1), 1000);  // 1000 * 2^0
  assert.equal(calculateReconnectDelay(2), 2000);  // 1000 * 2^1
  assert.equal(calculateReconnectDelay(3), 4000);  // 1000 * 2^2
  assert.equal(calculateReconnectDelay(4), 5000);  // 8000 → cap 5000
  assert.equal(calculateReconnectDelay(10), 5000); // 远大 → cap
});

test('calculateRetryDelay：同指数公式，MAX_DELAY=10000', () => {
  assert.equal(calculateRetryDelay(1), 1000);
  assert.equal(calculateRetryDelay(2), 2000);
  assert.equal(calculateRetryDelay(3), 4000);
  assert.equal(calculateRetryDelay(4), 8000);
  assert.equal(calculateRetryDelay(5), 10000); // 16000 → cap
});

// ==================== shouldRetry ====================

test('shouldRetry：attempt >= MAX_RETRIES 拒绝（无论错误类型）', () => {
  const timeoutErr = Object.assign(new Error('t'), { name: 'TimeoutError' });
  assert.equal(shouldRetry(timeoutErr, RETRY_CONFIG.MAX_RETRIES), false);
  assert.equal(shouldRetry(timeoutErr, RETRY_CONFIG.MAX_RETRIES + 5), false);
});

test('shouldRetry：TimeoutError + RETRY_ON_TIMEOUT=true → 允许', () => {
  const err = Object.assign(new Error('t'), { name: 'TimeoutError' });
  assert.equal(shouldRetry(err, 1), true);
});

test('shouldRetry：NetworkError + RETRY_ON_NETWORK_ERROR=true → 允许', () => {
  const err = Object.assign(new Error('n'), { name: 'NetworkError' });
  assert.equal(shouldRetry(err, 1), true);
});

test('shouldRetry：其他 Error 类型（name=Error）不重试', () => {
  // 当前实现只对 TimeoutError/NetworkError 放行；普通 Error 不重试
  assert.equal(shouldRetry(new Error('generic'), 1), false);
  assert.equal(shouldRetry(new TypeError('x'), 1), false);
});

// ==================== withTimeout ====================

test('withTimeout：promise 在 timeout 内 resolve → 透传', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000);
  assert.equal(result, 'ok');
});

test('withTimeout：promise 超时 → 抛 TimeoutError', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 200));
  await assert.rejects(
    () => withTimeout(slow, 30, 'too slow'),
    (err) => {
      assert.equal(err.name, 'TimeoutError');
      assert.equal(err.message, 'too slow');
      return true;
    }
  );
});

test('withTimeout：自定义 errorMessage', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('x'), 100));
  await assert.rejects(
    () => withTimeout(slow, 20, 'custom-msg'),
    (err) => err.message === 'custom-msg'
  );
});

// ==================== withRetry ====================

test('withRetry：fn 首次成功 → 仅调一次', async () => {
  let calls = 0;
  const fn = async () => { calls++; return 'ok'; };
  const wrapped = withRetry(fn);
  const result = await wrapped();
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry：TimeoutError 在 MAX_RETRIES 内重试到耗尽 → 抛最后错误', async () => {
  let calls = 0;
  const err = Object.assign(new Error('t'), { name: 'TimeoutError' });
  const fn = async () => { calls++; throw err; };
  const wrapped = withRetry(fn, { MAX_RETRIES: 3, INITIAL_DELAY: 1, MAX_DELAY: 1 });
  await assert.rejects(() => wrapped(), (e) => e.name === 'TimeoutError');
  assert.equal(calls, 3, '应调用 3 次');
});

test('withRetry：普通 Error 不重试 → 立即抛', async () => {
  let calls = 0;
  const fn = async () => { calls++; throw new Error('generic'); };
  const wrapped = withRetry(fn, { MAX_RETRIES: 3, INITIAL_DELAY: 1, MAX_DELAY: 1 });
  await assert.rejects(() => wrapped(), (e) => e.message === 'generic');
  assert.equal(calls, 1, '非 retriable 错误不应重试');
});

test('withRetry：中途成功则停止', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    return 'recovered';
  };
  const wrapped = withRetry(fn, { MAX_RETRIES: 3, INITIAL_DELAY: 1, MAX_DELAY: 1 });
  const r = await wrapped();
  assert.equal(r, 'recovered');
  assert.equal(calls, 2);
});

// ==================== createPoller ====================

test('createPoller：start → 首次立即执行 fn，再按 interval 重复', async () => {
  let calls = 0;
  const fn = async () => { calls++; };
  const poller = createPoller(fn, 20);
  poller.start();
  // 启动后立即一次；等待若干 interval 后再触发若干次
  await new Promise((r) => setTimeout(r, 75));
  poller.stop();
  assert.ok(calls >= 2, `至少调用 2 次（实际 ${calls}）`);
});

test('createPoller：stop 立即停止后续 poll', async () => {
  let calls = 0;
  const fn = async () => { calls++; };
  const poller = createPoller(fn, 30);
  poller.start();
  await new Promise((r) => setTimeout(r, 10));
  const before = calls;
  poller.stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, before, 'stop 后不应再调用');
});

test('createPoller：shouldContinue 返回 false 自动停', async () => {
  let calls = 0;
  const fn = async () => { calls++; };
  const poller = createPoller(fn, 20, () => calls < 2);
  poller.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(calls <= 2, `达到限制后停（实际 ${calls}）`);
  poller.stop();
});

test('createPoller：isRunning 反映状态', () => {
  const poller = createPoller(async () => {}, 1000);
  assert.equal(poller.isRunning(), false);
  poller.start();
  assert.equal(poller.isRunning(), true);
  poller.stop();
  assert.equal(poller.isRunning(), false);
});

// ==================== debounce ====================

test('debounce：连续触发只在最后一次延迟后执行', async () => {
  let calls = 0;
  const fn = () => calls++;
  const debounced = debounce(fn, 30);
  debounced(); debounced(); debounced();
  assert.equal(calls, 0, '立即期内未执行');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1, '只在最后一次延迟后执行 1 次');
});

test('debounce：传入最新参数', async () => {
  let received = null;
  const fn = (x) => { received = x; };
  const debounced = debounce(fn, 20);
  debounced(1); debounced(2); debounced(3);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received, 3);
});

// ==================== throttle ====================

test('throttle：delay 窗口内多次调用仅第一次执行', () => {
  let calls = 0;
  const fn = () => calls++;
  const throttled = throttle(fn, 50);
  throttled(); throttled(); throttled();
  assert.equal(calls, 1, '首调立即执行，后续被节流');
});

test('throttle：过 delay 后再次可执行', async () => {
  let calls = 0;
  const fn = () => calls++;
  const throttled = throttle(fn, 30);
  throttled();
  await new Promise((r) => setTimeout(r, 50));
  throttled();
  assert.equal(calls, 2);
});

// ==================== 配置数据完整性 ====================

test('RECONNECT_CONFIG / RETRY_CONFIG / POLLING_CONFIG / CACHE_CONFIG：字段 > 0', () => {
  for (const cfg of [RECONNECT_CONFIG, RETRY_CONFIG, POLLING_CONFIG, CACHE_CONFIG]) {
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'number') assert.ok(v > 0, `${k} = ${v} 应 > 0`);
    }
  }
});
