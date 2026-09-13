import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('托管恢复回调页面对外部授权跳转可访问', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const resources = manifest.web_accessible_resources?.flatMap(item => item.resources || []) || [];
  assert.ok(resources.includes('html/recovery-callback.html'));
  assert.ok(resources.includes('js/recovery-callback.js'));
});
