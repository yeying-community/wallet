import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMpcWalletName } from '../js/background/operations/mpc.js';

test('resolveMpcWalletName 兼容邀请 payload 中的钱包名称字段', () => {
  assert.equal(resolveMpcWalletName({ name: '家庭金库' }), '家庭金库');
  assert.equal(resolveMpcWalletName({ walletName: '团队金库' }), '团队金库');
  assert.equal(resolveMpcWalletName({ wallet: { name: '项目金库' } }), '项目金库');
  assert.equal(resolveMpcWalletName({ metadata: { walletName: '社区金库' } }), '社区金库');
  assert.equal(resolveMpcWalletName({ metadata: { name: '运营金库' } }), '运营金库');
  assert.equal(resolveMpcWalletName({ title: 'MPC 钱包创建邀请' }), 'MPC Wallet');
  assert.equal(resolveMpcWalletName({ name: 'MPC 钱包创建邀请' }), 'MPC Wallet');
  assert.equal(resolveMpcWalletName({ name: 'MPC 钱包邀请' }), 'MPC Wallet');
  assert.equal(resolveMpcWalletName({}), 'MPC Wallet');
});
