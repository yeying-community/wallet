import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTargetUcanAudience } from '../js/background/target-ucan-manager.js';

test('local target audience follows the endpoint instead of a cached remote audience', () => {
  assert.equal(resolveTargetUcanAudience({
    endpoint: 'http://localhost:8100',
    storedAudience: 'did:web:node.yeying.pub'
  }), 'did:web:localhost:8100');
  assert.equal(resolveTargetUcanAudience({
    endpoint: 'http://127.0.0.1:8100/',
    storedAudience: 'did:web:node.yeying.pub'
  }), 'did:web:127.0.0.1:8100');
});

test('explicit and stored audiences remain available for non-local targets', () => {
  assert.equal(resolveTargetUcanAudience({
    endpoint: 'https://node.example',
    explicitAudience: 'did:web:custom.example',
    storedAudience: 'did:web:stored.example'
  }), 'did:web:custom.example');
  assert.equal(resolveTargetUcanAudience({
    endpoint: 'https://node.example',
    storedAudience: 'did:web:stored.example'
  }), 'did:web:stored.example');
});
