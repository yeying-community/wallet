import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { AccountListController } from '../js/controller/account/account-list-controller.js';

function render(wallets) {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList(wallets);
    return { controller, html: elements.walletList.innerHTML };
  } finally {
    delete globalThis.document;
  }
}

const HD_WALLET = {
  id: 'w1', name: 'HD Wallet', type: 'hd',
  accounts: [{ id: 'a1', name: '账户 1', address: '0x1111111111111111111111111111111111111111', namespace: 'eip155', chainKey: 'eip155:1' }],
};

const ZHIXING_WALLET = {
  id: 'w2', name: '知行图钱包', type: 'imported',
  accounts: [{ id: 'a2', name: '知行图账户', address: '3a22534f13e7cfbd034670971a8a4c4ba4d7ca43d6d6908761502b612820f98b', namespace: 'zhixing', chainKey: 'zhixing:testnet' }],
};

test('账户行是「⋯」菜单,不是两个图标', () => {
  const { html } = render([HD_WALLET]);
  assert.match(html, /account-menu-btn/);
  assert.doesNotMatch(html, /view-private-key-btn/);
  assert.doesNotMatch(html, /class="account-action-btn danger delete-btn"/);
  // 菜单按钮带着账户号,点了才知道给谁开菜单
  assert.match(html, /data-account-id="a1"/);
});

test('钱包头部也有「⋯」菜单', () => {
  const { html } = render([HD_WALLET, ZHIXING_WALLET]);
  // 两个钱包各一个
  assert.equal((html.match(/data-menu-kind="wallet"/g) || []).length, 2);
  // 两个账户各一个
  assert.equal((html.match(/data-menu-kind="account"/g) || []).length, 2);
});

test('HD 钱包保留助记词图标;导入的钱包没有', () => {
  const hd = render([HD_WALLET]).html;
  assert.match(hd, /view-mnemonic-btn/);
  const imported = render([ZHIXING_WALLET]).html;
  assert.doesNotMatch(imported, /view-mnemonic-btn/);
});

test('账户菜单的项:查看私钥、加密导出、删除账户', () => {
  const { controller } = render([HD_WALLET]);
  const items = controller.accountMenuItems({ id: 'a1', namespace: 'eip155' });
  assert.deepEqual(items.map(i => i.action), ['view-private-key', 'export-keyfile', 'delete-account']);
});

test('知行图账户也有加密导出(链侧要用那个格式)', () => {
  const { controller } = render([ZHIXING_WALLET]);
  const items = controller.accountMenuItems({ id: 'a2', namespace: 'zhixing' });
  assert.deepEqual(items.map(i => i.action), ['view-private-key', 'export-keyfile', 'delete-account']);
});

test('MPC 钱包没有加密导出(密钥分片不在单个账户里)', () => {
  const { controller } = render([]);
  const items = controller.accountMenuItems({ id: 'm1', namespace: 'mpc' });
  assert.deepEqual(items.map(i => i.action), ['view-private-key', 'delete-account']);
});

test('钱包菜单:HD 有助记词,导入的钱包给一句说明', () => {
  const { controller } = render([HD_WALLET, ZHIXING_WALLET]);
  const hd = controller.walletMenuItems({ id: 'w1', type: 'hd', encryptedMnemonic: 'enc' });
  assert.deepEqual(hd.map(i => i.action), ['view-mnemonic', 'export-wallet']);
  const imported = controller.walletMenuItems({ id: 'w2', type: 'imported' });
  assert.deepEqual(imported.map(i => i.action), ['no-mnemonic', 'export-wallet']);
});

test('HD 钱包但没存助记词 → 不给「查看助记词」(点了也解不开)', () => {
  const { controller } = render([HD_WALLET]);
  const items = controller.walletMenuItems({ id: 'w1', type: 'hd' });
  assert.deepEqual(items.map(i => i.action), ['no-mnemonic', 'export-wallet']);
});

test('菜单动作会转给对应的回调', () => {
  const calls = [];
  const { controller } = render([HD_WALLET]);
  controller.onViewPrivateKey = (id) => calls.push(['private-key', id]);
  controller.onOpenDeleteAccount = (id) => calls.push(['delete', id]);
  controller.onViewMnemonic = (id) => calls.push(['mnemonic', id]);
  controller.onExportAccountKeyfile = (id) => calls.push(['keyfile', id]);
  controller.onExportWallet = (id) => calls.push(['wallet', id]);

  controller.handleAccountMenuAction('view-private-key', 'a1');
  controller.handleAccountMenuAction('delete-account', 'a1');
  controller.handleAccountMenuAction('view-mnemonic', 'w1');
  controller.handleAccountMenuAction('export-keyfile', 'a2');
  controller.handleAccountMenuAction('export-wallet', 'w1');

  assert.deepEqual(calls, [
    ['private-key', 'a1'], ['delete', 'a1'], ['mnemonic', 'w1'], ['keyfile', 'a2'], ['wallet', 'w1'],
  ]);
});

test('没有回调时不报错(菜单项点了没反应也不能抛异常)', () => {
  const { controller } = render([HD_WALLET]);
  assert.doesNotThrow(() => {
    controller.handleAccountMenuAction('view-private-key', 'a1');
    controller.handleAccountMenuAction('export-keyfile', 'a1');
    controller.handleAccountMenuAction('no-mnemonic', 'a1');
    controller.handleAccountMenuAction(undefined, undefined);
  });
});

test('「没有助记词」是说明,不是能点的动作', () => {
  const { controller } = render([ZHIXING_WALLET]);
  const items = controller.walletMenuItems({ id: 'w2', type: 'imported' });
  const note = items.find(i => i.action === 'no-mnemonic');
  assert.ok(note, '要有这一项');
  assert.equal(note.noteOnly, true, '它只是说明,不该是个可点的动作');
});

test('菜单里的说明项渲染成不可点的灰字', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    const trigger = { getBoundingClientRect: () => ({ left: 100, right: 132, top: 40, bottom: 72 }), setAttribute() {} };
    globalThis.window = { innerHeight: 800 };
    controller.openAccountMenu(trigger, [
      { action: 'view-private-key', id: 'a1', label: '查看私钥' },
      { action: 'no-mnemonic', id: 'w2', label: '这个钱包没有助记词', noteOnly: true },
    ]);
    const menu = document.getElementById('accountActionMenu');
    assert.ok(menu, '菜单要挂在 document.body 上');
    const options = menu.querySelectorAll('.network-option');
    assert.equal(options.length, 2);
    const note = options[1];
    assert.equal(note.disabled, true, '说明项不可点');
    assert.equal(note.getAttribute('aria-disabled'), 'true');
    assert.equal(note.dataset.action, undefined, '说明项没有动作');
    assert.match(note.className, /note-only/);
    // 真正能点的那个仍然带着动作
    assert.equal(options[0].dataset.action, 'view-private-key');
    assert.equal(options[0].dataset.id, 'a1');
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
