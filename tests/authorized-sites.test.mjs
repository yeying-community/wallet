/**
 * AuthorizedSitesController DOM 集成测试（仓库内 DOM stub）
 * 运行：npm test
 *
 * 覆盖：列表渲染/过滤、详情 modal 开关、UCAN 会话展示、撤销按钮事件。
 * 这块过去只能 Chrome 实测，现在用最小 DOM stub 把主路径跑在 Node。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from './_helpers/dom-stub.js';

// ── 每个用例独立 setup/teardown —— 避免 globalThis.document 跨用例污染 ──
let elements;
let AuthorizedSitesController;

function setupDom() {
  const doc = createDocument({
    siteSearchInput: { tagName: 'input' },
    authorizedSitesList: { tagName: 'div' },
    siteDetailModal: { tagName: 'div' },
    siteDetailOrigin: { tagName: 'div' },
    siteDetailAddress: { tagName: 'div' },
    siteDetailTime: { tagName: 'div' },
    siteDetailUcanEmpty: { tagName: 'div' },
    siteDetailUcanRows: { tagName: 'div' },
    siteDetailUcanStatus: { tagName: 'div' },
    siteDetailUcanSession: { tagName: 'div' },
    siteDetailUcanDid: { tagName: 'div' },
    siteDetailUcanCreated: { tagName: 'div' },
    siteDetailUcanExpires: { tagName: 'div' },
    revokeSiteDetailBtn: { tagName: 'button' }
  });
  elements = doc.elements;
  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
  return doc.elements;
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window.confirm;
  delete globalThis.window.alert;
  delete globalThis.confirm;
  delete globalThis.alert;
}

test.beforeEach(async () => {
  setupDom();
  if (!AuthorizedSitesController) {
    AuthorizedSitesController = (await import('../js/controller/settings/authorized-sites-controller.js')).AuthorizedSitesController;
  }
});
test.afterEach(() => { teardown(); });

function fakeWallet(sites = [], session = null) {
  const wallet = {
    calls: { revoke: null, clear: false },
    getAuthorizedSites: async () => sites,
    revokeSite: async (origin) => { wallet.calls.revoke = origin; },
    clearAllAuthorizations: async () => { wallet.calls.clear = true; },
    getSiteUcanSession: async (origin, address) => session
  };
  return wallet;
}

test('loadAuthorizedSites：空列表显示「暂无授权网站」', async () => {
  const wallet = fakeWallet([]);
  const c = new AuthorizedSitesController({ wallet });
  await c.loadAuthorizedSites();
  assert.match(elements.authorizedSitesList.innerHTML, /暂无授权网站/);
  assert.deepEqual(c.cachedSites, []);
});

test('loadAuthorizedSites：渲染 origin + 短地址 + 时间', async () => {
  const wallet = fakeWallet([
    { origin: 'https://app.example', address: '0x1111111111111111111111111111111111111111', timestamp: 1700000000000 }
  ]);
  const c = new AuthorizedSitesController({ wallet });
  await c.loadAuthorizedSites();
  const html = elements.authorizedSitesList.innerHTML;
  assert.match(html, /app\.example/);
  assert.match(html, /0x1111[^*]+1111/); // shortened via shortenAddress
  assert.match(html, /data-origin="https%3A%2F%2Fapp\.example"/); // URL-encoded dataset
  assert.match(html, /data-mpc-action|btn-revoke|撤销|REVOKE/i);
  assert.deepEqual(c.cachedSites.length, 1);
});

test('filterAuthorizedSites：按 origin 关键字过滤', async () => {
  const wallet = fakeWallet([
    { origin: 'https://app1.example', address: '0xaaaa', timestamp: 1 },
    { origin: 'https://app2.example', address: '0xbbbb', timestamp: 2 },
    { origin: 'https://other.org', address: '0xcccc', timestamp: 3 }
  ]);
  const c = new AuthorizedSitesController({ wallet });
  await c.loadAuthorizedSites();
  c.filterAuthorizedSites('app1');
  const html = elements.authorizedSitesList.innerHTML;
  assert.match(html, /app1\.example/);
  assert.ok(!html.includes('app2\.example'), '应过滤掉非匹配项');
  assert.ok(!html.includes('other\.org'));
});

test('bindEvents：搜索框 input 触发 filterAuthorizedSites', async () => {
  const wallet = fakeWallet([
    { origin: 'https://a.example', address: '0x1', timestamp: 1 }
  ]);
  const c = new AuthorizedSitesController({ wallet });
  c.bindEvents();
  await c.loadAuthorizedSites();
  // 模拟用户输入 → 触发过滤
  elements.siteSearchInput.value = 'zzz_no_match';
  elements.siteSearchInput.dispatchEvent({ type: 'input' });
  assert.match(elements.authorizedSitesList.innerHTML, /暂无授权网站|没有匹配/);
  // 重置 + 触发现有匹配
  elements.siteSearchInput.value = 'a\.example';
  elements.siteSearchInput.dispatchEvent({ type: 'input' });
  assert.match(elements.authorizedSitesList.innerHTML, /a\.example/);
});

test('openSiteDetailModal：填充 origin/address/time 并打开 modal', async () => {
  const wallet = fakeWallet();
  const c = new AuthorizedSitesController({ wallet });
  elements.siteDetailModal.classList.add('hidden');
  await c.openSiteDetailModal({ origin: 'https://dapp.example', address: '0xdeadbeef', timestamp: 1700000000000 });
  assert.equal(elements.siteDetailOrigin.textContent, 'https://dapp.example');
  assert.equal(elements.siteDetailAddress.textContent, '0xdeadbeef');
  assert.ok(elements.siteDetailModal.classList.contains('hidden') === false, 'modal 应已打开');
  assert.deepEqual(c.activeSiteDetail, { origin: 'https://dapp.example', address: '0xdeadbeef', timestamp: 1700000000000 });
});

test('openSiteDetailModal → loadSiteUcanSession 异步填入会话详情', async () => {
  const wallet = fakeWallet([], { id: 'sess-1', did: 'did:key:abc', createdAt: 1000, expiresAt: 2000, isActive: true });
  const c = new AuthorizedSitesController({ wallet });
  await c.openSiteDetailModal({ origin: 'https://x', address: '0x1', timestamp: 1 });
  // openSiteDetailModal 触发 void loadSiteUcanSession —— 等异步完成
  await new Promise((res) => setTimeout(res, 0));
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(elements.siteDetailUcanSession.textContent, 'sess-1');
  assert.equal(elements.siteDetailUcanDid.textContent, 'did:key:abc');
  assert.match(elements.siteDetailUcanStatus.textContent, /当前有效/);
});

test('closeSiteDetailModal：modal 隐藏且 activeSiteDetail 清空', async () => {
  const wallet = fakeWallet();
  const c = new AuthorizedSitesController({ wallet });
  await c.openSiteDetailModal({ origin: 'https://x', address: '0x1', timestamp: 1 });
  c.closeSiteDetailModal();
  assert.ok(elements.siteDetailModal.classList.contains('hidden'));
  assert.equal(c.activeSiteDetail, null);
});

test('handleRevokeSite：点击 .btn-revoke 触发 wallet.revokeSite', async () => {
  const wallet = fakeWallet();
  const c = new AuthorizedSitesController({ wallet });
  c.bindEvents();
  await c.loadAuthorizedSites();
  // 直接构造一个 .btn-revoke 节点（手动设 parent 使 closest 走通）并触发 click
  const list = elements.authorizedSitesList;
  const btn = createElement({ tagName: 'button', parent: list });
  btn.classList.add('btn-revoke');
  btn.dataset.origin = encodeURIComponent('https://target.example');
  list.children.push(btn);
  btn.click();
  assert.equal(wallet.calls.revoke, 'https://target.example');
});

test('handleClearAllAuthorizations：调用 wallet.clearAllAuthorizations', async () => {
  const wallet = fakeWallet();
  const c = new AuthorizedSitesController({ wallet });
  await c.handleClearAllAuthorizations();
  assert.equal(wallet.calls.clear, true);
});