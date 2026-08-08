import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessageBuilder,
  MessageValidator,
  PROTOCOL_VERSION
} from '../js/protocol/dapp-protocol.js';

test('构造的请求符合当前协议约束', () => {
  const request = MessageBuilder.createRequest('eth_accounts');
  assert.equal(request.version, PROTOCOL_VERSION);
  assert.deepEqual(MessageValidator.validateRequest(request), { valid: true });
});

test('拒绝缺失和不受支持的协议版本', () => {
  const missing = MessageBuilder.createRequest('eth_accounts');
  delete missing.version;
  assert.deepEqual(MessageValidator.validateRequest(missing), {
    valid: false,
    error: 'Missing version'
  });

  const future = MessageBuilder.createRequest('eth_accounts');
  future.version = '2.0.0';
  assert.deepEqual(MessageValidator.validateRequest(future), {
    valid: false,
    error: 'Unsupported protocol version'
  });
});
