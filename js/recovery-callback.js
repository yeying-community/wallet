const status = document.getElementById('status');
const params = new URLSearchParams(window.location.search);
const code = params.get('code') || '';
const state = params.get('state') || '';
const error = params.get('error') || '';

try {
  const result = await chrome.runtime.sendMessage({
    type: 'WALLET_RECOVERY_CALLBACK',
    data: { code, state, error }
  });
  if (!result?.success) throw new Error(result?.error || '回调处理失败');
  status.textContent = '已返回钱包，请关闭此页面。';
  window.setTimeout(() => window.close(), 500);
} catch (err) {
  status.textContent = `恢复授权失败：${err.message}`;
}
