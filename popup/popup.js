// popup.js

// 获取钱包地址和余额（这些数据在实际中应通过钱包接口获取）
const walletAddress = "0x8c41a...1EeD3";
const balanceAmount = "$1000.00 USD";
const balanceETH = "10 ETH";

// 设置账户信息
document.getElementById('accountAddress').textContent = walletAddress;
document.getElementById('balanceAmount').textContent = balanceAmount;
document.getElementById('balanceETH').textContent = balanceETH;

// 网络切换逻辑
const networkDropdownButton = document.getElementById('networkDropdownButton');
const networkDropdown = document.getElementById('networkDropdownButton');

networkDropdown.addEventListener('change', (event) => {
  alert(`你选择了：${event.target.value}`);
});

// 按钮操作
document.getElementById('depositButton').addEventListener('click', () => {
  alert('调用入金接口');
});

document.getElementById('swapButton').addEventListener('click', () => {
  alert('调用兑换接口');
});

document.getElementById('sendButton').addEventListener('click', () => {
  alert('调用发送交易接口');
});

document.getElementById('receiveButton').addEventListener('click', () => {
  alert('调用收款接口');
});

// 菜单操作
document.getElementById('accountDetails').addEventListener('click', () => {
  alert('查看账户详情');
});

document.getElementById('viewExplorer').addEventListener('click', () => {
  window.open(`https://etherscan.io/address/${walletAddress}`, '_blank');
});

document.getElementById('getHelp').addEventListener('click', () => {
  alert('获取帮助');
});

document.getElementById('settings').addEventListener('click', () => {
  alert('进入设置');
});

// 退出登录操作
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('walletAddress');
  window.location.href = 'onboarding.html';  // 退出后跳转回登录界面
});


// 显示侧边栏（点击三条线的图标时）
document.getElementById('hamburgerMenu').addEventListener('click', (event) => {
  // 阻止点击菜单栏时事件冒泡，防止触发关闭菜单的逻辑
  event.stopPropagation();
  document.getElementById('sidebar').classList.add('open'); // 展开侧边栏
});

// 点击页面其他地方时，关闭侧边栏
document.addEventListener('click', (event) => {
  const sidebar = document.getElementById('sidebar');
  const hamburgerMenu = document.getElementById('hamburgerMenu');
  
  // 检查点击的是否是菜单栏或菜单按钮，不是则关闭菜单
  if (!sidebar.contains(event.target) && !hamburgerMenu.contains(event.target)) {
    sidebar.classList.remove('open'); // 关闭侧边栏
  }
});
