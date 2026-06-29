/**
 * transaction-config gas / EIP-1559 费用计算与校验单测（纯函数，零 DOM）
 * 运行：npm test
 *
 * 费用算错 = 交易卡住或多付，属资产相关。本文件覆盖默认 gas limit、价格级别倍率、
 * gas limit/price 校验边界、legacy 费用换算、EIP-1559 费用换算与校验。
 *
 * 含一条回归：validateGasPrice 超上限分支此前因变量名拼错（GAS__CONFIG）会抛
 * ReferenceError，本测试覆盖该分支。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultGasLimit,
  calculateGasPrice,
  validateGasLimit,
  validateGasPrice,
  calculateTransactionFee,
  calculateEIP1559Fee,
  validateEIP1559Fee,
  TRANSACTION_TYPES,
  GAS_CONFIG
} from '../js/config/transaction-config.js';

// ==================== getDefaultGasLimit ====================

test('getDefaultGasLimit：按类型返回，默认走 SEND', () => {
  assert.equal(getDefaultGasLimit(TRANSACTION_TYPES.SEND), 21000);
  assert.equal(getDefaultGasLimit(TRANSACTION_TYPES.TOKEN_TRANSFER), 65000);
  assert.equal(getDefaultGasLimit(TRANSACTION_TYPES.CONTRACT_INTERACTION), 100000);
  assert.equal(getDefaultGasLimit('unknown'), 21000, '未知类型回退 SEND 默认');
  assert.equal(getDefaultGasLimit(), 21000);
});

// ==================== calculateGasPrice ====================

test('calculateGasPrice：按级别倍率，向上取整', () => {
  assert.equal(calculateGasPrice(100, 'slow'), 80);      // 100*0.8
  assert.equal(calculateGasPrice(100, 'standard'), 100); // 100*1.0
  assert.equal(calculateGasPrice(100, 'fast'), 120);     // 100*1.2
  assert.equal(calculateGasPrice(100, 'instant'), 150);  // 100*1.5
  assert.equal(calculateGasPrice(33, 'fast'), 40, '33*1.2=39.6 → ceil 40');
});

test('calculateGasPrice：未知级别返回原价', () => {
  assert.equal(calculateGasPrice(100, 'nope'), 100);
});

// ==================== validateGasLimit ====================

test('validateGasLimit：边界', () => {
  assert.equal(validateGasLimit(GAS_CONFIG.MIN_GAS_LIMIT).valid, true);
  assert.equal(validateGasLimit(GAS_CONFIG.MAX_GAS_LIMIT).valid, true);
  assert.equal(validateGasLimit(GAS_CONFIG.MIN_GAS_LIMIT - 1).valid, false);
  assert.equal(validateGasLimit(GAS_CONFIG.MAX_GAS_LIMIT + 1).valid, false);
});

// ==================== validateGasPrice（含 bug 回归） ====================

test('validateGasPrice：低于下限被拒', () => {
  const r = validateGasPrice(GAS_CONFIG.MIN_GAS_PRICE - 0.5);
  assert.equal(r.valid, false);
  assert.match(r.error, /at least/);
});

test('★ validateGasPrice：超上限被拒（此前因 GAS__CONFIG 拼错会抛 ReferenceError）', () => {
  let r;
  assert.doesNotThrow(() => { r = validateGasPrice(GAS_CONFIG.MAX_GAS_PRICE + 1); });
  assert.equal(r.valid, false);
  assert.match(r.error, /not exceed/);
});

test('validateGasPrice：区间内通过', () => {
  assert.equal(validateGasPrice(GAS_CONFIG.MIN_GAS_PRICE).valid, true);
  assert.equal(validateGasPrice(GAS_CONFIG.MAX_GAS_PRICE).valid, true);
  assert.equal(validateGasPrice(50).valid, true);
});

// ==================== calculateTransactionFee（legacy） ====================

test('calculateTransactionFee：21000 gas × 100 Gwei = 0.0021 ETH', () => {
  // 21000 * 100e9 wei = 2.1e15 wei = 0.0021 ETH
  assert.equal(calculateTransactionFee(21000, 100), '0.0021');
});

test('calculateTransactionFee：1 Gwei × 21000', () => {
  // 21000 * 1e9 = 2.1e13 wei = 0.000021 ETH
  assert.equal(calculateTransactionFee(21000, 1), '0.000021');
});

// ==================== calculateEIP1559Fee ====================

test('calculateEIP1559Fee：换算 maxFee/priorityFee/estimatedFee', () => {
  // gasLimit=21000, maxFee=100Gwei, priority=2Gwei
  const r = calculateEIP1559Fee(21000, 100, 2);
  assert.equal(r.maxFee, '0.0021');        // 21000*100e9/1e18
  assert.equal(r.priorityFee, '0.000042'); // 21000*2e9/1e18
  assert.equal(r.estimatedFee, '0.0021', 'estimatedFee 取 maxFee');
});

// ==================== validateEIP1559Fee ====================

test('validateEIP1559Fee：合法组合通过', () => {
  const r = validateEIP1559Fee(50, 2); // maxFee 50, priority 2
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateEIP1559Fee：priority > maxFee → 报错', () => {
  const r = validateEIP1559Fee(2, 50); // maxFee 2 < priority 50
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Priority fee cannot exceed max fee/.test(e)));
});

test('validateEIP1559Fee：priority 低于下限', () => {
  const r = validateEIP1559Fee(50, GAS_CONFIG.EIP1559.MIN_PRIORITY_FEE - 0.5);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Priority fee must be at least/.test(e)));
});

test('validateEIP1559Fee：maxFee 超上限', () => {
  const r = validateEIP1559Fee(GAS_CONFIG.EIP1559.MAX_MAX_FEE + 1, 2);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Max fee must not exceed/.test(e)));
});

test('validateEIP1559Fee：priority 超上限', () => {
  // priority 超上限但仍 <= maxFee（避免触发 priority>maxFee）
  const r = validateEIP1559Fee(GAS_CONFIG.EIP1559.MAX_MAX_FEE, GAS_CONFIG.EIP1559.MAX_PRIORITY_FEE + 1);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Priority fee must not exceed/.test(e)));
});
