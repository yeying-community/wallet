import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { AccountListController } from '../js/controller/account/account-list-controller.js';

test('账户管理为待 Keygen 的 MPC 钱包显示协作状态而不是暂无账户', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: '家庭金库',
      type: 'mpc',
      status: 'keygen_pending',
      threshold: 2,
      participants: ['0x1', '0x2', '0x3'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /MPC Wallet/);
    assert.match(elements.walletList.innerHTML, /等待参与者完成密钥生成/);
    assert.match(elements.walletList.innerHTML, /门限 2 \/ 3/);
    assert.doesNotMatch(elements.walletList.innerHTML, /暂无账户/);
  } finally {
    delete globalThis.document;
  }
});
