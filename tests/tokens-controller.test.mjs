/**
 * TokensController DOM 集成测试
 * 运行：npm test
 *
 * 覆盖：loadTokenBalances（合并 native + ERC20、缓存 lastTokenList、容错）、
 * renderTokenBalances（空态 / 列表 / 原生标记 / XSS 转义）、getCurrentTransferToken 委派。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let TokensController;

function setupDom() {
  const doc = createDocument({
    tokenList: { tagName: 'div' }
  });
  elements = doc.elements;
  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
  return doc.elements;
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window;
}

test.beforeEach(async () => {
  setupDom();
  if (!TokensController) {
    TokensController = (await import('../js/controller/tokens/tokens-controller.js')).TokensController;
  }
});
test.afterEach(() => { teardown(); });

function fakeToken({ native = null, tokens = [] } = {}) {
  return {
    getNativeToken: async () => native,
    getTokenBalances: async () => tokens
  };
}

function fakeWallet(account = { address: '0x1111111111111111111111111111111111111111' }) {
  return { getCurrentAccount: async () => account };
}

test('loadTokenBalances：无 wallet/token → 渲染空、返回 []', async () => {
  const c = new TokensController({});
  const result = await c.loadTokenBalances();
  assert.deepEqual(result, []);
  assert.match(elements.tokenList.innerHTML, /暂无通证/);
});

test('loadTokenBalances：无当前账户 → 空', async () => {
  const c = new TokensController({ wallet: fakeWallet(null), token: fakeToken() });
  const result = await c.loadTokenBalances();
  assert.deepEqual(result, []);
});

test('loadTokenBalances：native + ERC20 合并，native 在前', async () => {
  const native = { symbol: 'ETH', name: 'Ether', balance: '1.5', isNative: true };
  const tokens = [
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', balance: '100' }
  ];
  const c = new TokensController({ wallet: fakeWallet(), token: fakeToken({ native, tokens }) });
  const list = await c.loadTokenBalances();
  assert.equal(list.length, 2);
  assert.equal(list[0].symbol, 'ETH', 'native 应在第一个');
  assert.equal(list[1].symbol, 'USDC');
  assert.deepEqual(c.lastTokenList, list, '应缓存 lastTokenList');
});

test('loadTokenBalances：无 native（getNativeToken 返 null）→ 仅 ERC20', async () => {
  const tokens = [{ symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', balance: '5' }];
  const c = new TokensController({ wallet: fakeWallet(), token: fakeToken({ native: null, tokens }) });
  const list = await c.loadTokenBalances();
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'DAI');
});

test('loadTokenBalances：token 域抛错 → 渲染空、返回 []（容错）', async () => {
  const token = { getNativeToken: async () => { throw new Error('rpc down'); }, getTokenBalances: async () => [] };
  const c = new TokensController({ wallet: fakeWallet(), token });
  const result = await c.loadTokenBalances();
  assert.deepEqual(result, []);
  assert.match(elements.tokenList.innerHTML, /暂无通证/);
});

test('renderTokenBalances：空数组 → 空态', () => {
  const c = new TokensController({});
  c.renderTokenBalances([]);
  assert.match(elements.tokenList.innerHTML, /暂无通证/);
});

test('renderTokenBalances：渲染 symbol/balance/原生标记', () => {
  const c = new TokensController({});
  c.renderTokenBalances([
    { symbol: 'ETH', name: 'Ether', balance: '2.0', isNative: true },
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', balance: '100' }
  ]);
  const html = elements.tokenList.innerHTML;
  assert.match(html, /ETH/);
  assert.match(html, /USDC/);
  assert.match(html, /原生/, '原生代币应有标记');
  assert.match(html, /2\.0/);
  assert.match(html, /100/);
  assert.match(html, /native/, '原生项应有 native class');
});

test('renderTokenBalances：缺 balance 显示 0', () => {
  const c = new TokensController({});
  c.renderTokenBalances([{ symbol: 'FOO', name: 'Foo' }]);
  assert.match(elements.tokenList.innerHTML, /0/);
});

test('getCurrentTransferToken：委派给 transferController', () => {
  const c = new TokensController({});
  c.transferController.getCurrentTransferToken = () => ({ symbol: 'MOCK' });
  assert.deepEqual(c.getCurrentTransferToken(), { symbol: 'MOCK' });
});

test('setNetworkController：同步设置自身与 transferController', () => {
  const c = new TokensController({});
  let transferSet = null;
  c.transferController.setNetworkController = (ctrl) => { transferSet = ctrl; };
  const ctrl = { id: 'net-ctrl' };
  c.setNetworkController(ctrl);
  assert.equal(c.networkController, ctrl);
  assert.equal(transferSet, ctrl);
});
