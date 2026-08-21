import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMpcWalletName } from '../js/background/operations/mpc.js';

test('resolveMpcWalletName 只从协议字段 name 读取钱包名称', () => {
  assert.equal(resolveMpcWalletName({ name: '家庭金库' }), '家庭金库');
  assert.equal(resolveMpcWalletName({ payload: { name: '团队金库' } }), '团队金库');
  assert.throws(() => resolveMpcWalletName({ walletName: '团队金库' }), /MPC 钱包名称缺失/);
  assert.throws(() => resolveMpcWalletName({ wallet: { name: '项目金库' } }), /MPC 钱包名称缺失/);
  assert.throws(() => resolveMpcWalletName({ metadata: { walletName: '社区金库' } }), /MPC 钱包名称缺失/);
  assert.throws(() => resolveMpcWalletName({ name: 'MPC 钱包创建邀请' }), /MPC 钱包名称缺失/);
  assert.throws(() => resolveMpcWalletName({ name: 'MPC 钱包邀请' }), /MPC 钱包名称缺失/);
  assert.throws(() => resolveMpcWalletName({}), /MPC 钱包名称缺失/);
});
