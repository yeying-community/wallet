// 后台脚本
chrome.runtime.onInstalled.addListener(() => {
  console.log('简易钱包插件已安装');
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBalance') {
    // 可以在这里处理后台任务
    sendResponse({ success: true });
  }
  return true;
});

