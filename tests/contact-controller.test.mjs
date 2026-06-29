/**
 * ContactController DOM 集成测试
 * 运行：npm test
 *
 * 覆盖：loadContacts（渲染 + select + 回调 + 容错）、handleAddContact（校验 / 新增 vs 编辑分支）、
 * handleEditContact（回填表单 + 进入编辑态）、clearEditMode、handleDeleteContact（confirm + 删除）、
 * normalizeImportedContacts（多种导入格式，纯函数）、renderContacts（空态 / 列表）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let ContactController;

function setupDom() {
  const doc = createDocument({
    contactsList: { tagName: 'div' },
    contactMenu: { tagName: 'div' },
    contactSelectorBtn: { tagName: 'button' },
    recipientAddress: { tagName: 'input' },
    contactEditorModal: { tagName: 'div' },
    contactNameInput: { tagName: 'input' },
    contactAddressInput: { tagName: 'input' },
    contactNoteInput: { tagName: 'input' },
    contactIdInput: { tagName: 'input' },
    addContactBtn: { tagName: 'button' },
    contactModalTitle: { tagName: 'div' },
    contactsPage: { tagName: 'div' }
  });
  elements = doc.elements;
  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
  globalThis.confirm = () => true;
  return doc.elements;
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.confirm;
}

test.beforeEach(async () => {
  setupDom();
  if (!ContactController) {
    ContactController = (await import('../js/controller/contact-controller.js')).ContactController;
  }
});
test.afterEach(() => { teardown(); });

function fakeWallet(contacts = []) {
  const calls = { add: [], update: [], delete: [] };
  const wallet = {
    calls,
    getContacts: async () => contacts,
    addContact: async (c) => { calls.add.push(c); },
    updateContact: async (c) => { calls.update.push(c); },
    deleteContact: async (id) => { calls.delete.push(id); }
  };
  return wallet;
}

// ==================== loadContacts ====================

test('loadContacts：空 → 渲染「暂无联系人」+ 缓存空 + 触发回调', async () => {
  let cbArg;
  const c = new ContactController({ wallet: fakeWallet([]), onContactsUpdated: (x) => { cbArg = x; } });
  await c.loadContacts();
  assert.match(elements.contactsList.innerHTML, /暂无联系人/);
  assert.deepEqual(c.cachedContacts, []);
  assert.deepEqual(cbArg, []);
});

test('loadContacts：渲染联系人 + 短地址 + select 选项', async () => {
  const contacts = [
    { id: 'c1', name: 'Alice', address: '0x1111111111111111111111111111111111111111', note: 'friend' }
  ];
  const c = new ContactController({ wallet: fakeWallet(contacts) });
  await c.loadContacts();
  const html = elements.contactsList.innerHTML;
  assert.match(html, /Alice/);
  assert.match(html, /friend/);
  assert.match(html, /data-id="c1"/);
  assert.match(html, /data-action="copy"/);
  assert.match(html, /data-action="delete"/);
  // select 菜单也应渲染
  assert.match(elements.contactMenu.innerHTML, /Alice/);
  assert.equal(c.cachedContacts.length, 1);
});

test('loadContacts：wallet 抛错 → 容错渲染空', async () => {
  const wallet = { getContacts: async () => { throw new Error('db error'); } };
  const c = new ContactController({ wallet });
  await c.loadContacts();
  assert.match(elements.contactsList.innerHTML, /暂无联系人/);
  assert.deepEqual(c.cachedContacts, []);
});

// ==================== handleAddContact ====================

test('handleAddContact：缺名称 → 不调 wallet', async () => {
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  elements.contactNameInput.value = '';
  elements.contactAddressInput.value = '0xabc';
  await c.handleAddContact();
  assert.equal(wallet.calls.add.length, 0);
});

test('handleAddContact：缺地址 → 不调 wallet', async () => {
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  elements.contactNameInput.value = 'Bob';
  elements.contactAddressInput.value = '';
  await c.handleAddContact();
  assert.equal(wallet.calls.add.length, 0);
});

test('handleAddContact：合法 + 非编辑态 → addContact', async () => {
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  elements.contactNameInput.value = 'Bob';
  elements.contactAddressInput.value = '0x2222222222222222222222222222222222222222';
  elements.contactNoteInput.value = 'colleague';
  await c.handleAddContact();
  assert.equal(wallet.calls.add.length, 1);
  assert.deepEqual(wallet.calls.add[0], { name: 'Bob', address: '0x2222222222222222222222222222222222222222', note: 'colleague' });
  assert.equal(wallet.calls.update.length, 0);
  // 添加后关闭 editor modal
  assert.ok(elements.contactEditorModal.classList.contains('hidden'));
});

test('handleAddContact：编辑态 → updateContact（带 id）', async () => {
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  c.editingContactId = 'c9';
  elements.contactNameInput.value = 'Alice2';
  elements.contactAddressInput.value = '0x3333333333333333333333333333333333333333';
  await c.handleAddContact();
  assert.equal(wallet.calls.update.length, 1);
  assert.equal(wallet.calls.update[0].id, 'c9');
  assert.equal(wallet.calls.add.length, 0);
});

// ==================== handleEditContact / clearEditMode ====================

test('handleEditContact：回填表单 + 进入编辑态 + 改按钮文案', async () => {
  const contacts = [{ id: 'c1', name: 'Alice', address: '0x4444444444444444444444444444444444444444', note: 'n' }];
  const c = new ContactController({ wallet: fakeWallet(contacts) });
  c.cachedContacts = contacts;
  c.handleEditContact('c1');
  assert.equal(elements.contactNameInput.value, 'Alice');
  assert.equal(elements.contactAddressInput.value, '0x4444444444444444444444444444444444444444');
  assert.equal(c.editingContactId, 'c1');
  assert.equal(elements.addContactBtn.textContent, '保存修改');
  assert.equal(elements.contactModalTitle.textContent, '编辑联系人');
});

test('handleEditContact：未知 id → 不动表单', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  c.cachedContacts = [{ id: 'c1', name: 'Alice' }];
  elements.contactNameInput.value = 'preset';
  c.handleEditContact('missing');
  assert.equal(elements.contactNameInput.value, 'preset', '未知 id 不应改表单');
  assert.equal(c.editingContactId, null);
});

test('clearEditMode：清空表单 + 退出编辑态 + 恢复按钮文案', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  c.editingContactId = 'c1';
  elements.contactNameInput.value = 'x';
  elements.contactAddressInput.value = 'y';
  c.clearEditMode();
  assert.equal(elements.contactNameInput.value, '');
  assert.equal(elements.contactAddressInput.value, '');
  assert.equal(c.editingContactId, null);
  assert.equal(elements.addContactBtn.textContent, '添加联系人');
  assert.equal(elements.contactModalTitle.textContent, '添加联系人');
});

// ==================== handleDeleteContact ====================

test('handleDeleteContact：confirm=true → deleteContact + reload', async () => {
  const wallet = fakeWallet([{ id: 'c1', name: 'A', address: '0x1' }]);
  const c = new ContactController({ wallet });
  await c.handleDeleteContact('c1');
  assert.deepEqual(wallet.calls.delete, ['c1']);
});

test('handleDeleteContact：confirm=false → 不删', async () => {
  globalThis.confirm = () => false;
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  await c.handleDeleteContact('c1');
  assert.equal(wallet.calls.delete.length, 0);
});

test('handleDeleteContact：空 id → 直接返回', async () => {
  const wallet = fakeWallet();
  const c = new ContactController({ wallet });
  await c.handleDeleteContact('');
  assert.equal(wallet.calls.delete.length, 0);
});

// ==================== normalizeImportedContacts（纯函数） ====================

test('normalizeImportedContacts：数组', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  assert.deepEqual(c.normalizeImportedContacts([{ address: '0x1' }]), [{ address: '0x1' }]);
});

test('normalizeImportedContacts：{contacts:[...]}', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  assert.deepEqual(c.normalizeImportedContacts({ contacts: [{ address: '0x1' }] }), [{ address: '0x1' }]);
});

test('normalizeImportedContacts：{contacts:{map}}', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  const out = c.normalizeImportedContacts({ contacts: { a: { address: '0x1' }, b: { address: '0x2' } } });
  assert.equal(out.length, 2);
});

test('normalizeImportedContacts：{data:{contacts:[...]}}（备份格式）', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  assert.deepEqual(c.normalizeImportedContacts({ data: { contacts: [{ address: '0x9' }] } }), [{ address: '0x9' }]);
});

test('normalizeImportedContacts：空/非法 → []', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  assert.deepEqual(c.normalizeImportedContacts(null), []);
  assert.deepEqual(c.normalizeImportedContacts({}), []);
  assert.deepEqual(c.normalizeImportedContacts({ foo: 'bar' }), []);
});

// ==================== renderContacts 直测 ====================

test('renderContacts：空数组 → 空态', () => {
  const c = new ContactController({ wallet: fakeWallet() });
  c.renderContacts([]);
  assert.match(elements.contactsList.innerHTML, /暂无联系人/);
});
