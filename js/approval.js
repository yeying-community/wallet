// 处理授权页面逻辑

let isProcessing = false;
let requestId = null;
let requestType = null;
let requestData = null;

// 初始化
async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  requestId = urlParams.get('requestId');
  requestType = urlParams.get('type');

  // 从 background 获取请求详情
  const response = await chrome.runtime.sendMessage({
    type: 'GET_REQUEST_DETAILS',
    requestId
  });

  requestData = response.data;

  // 根据类型显示对应界面
  switch (requestType) {
    case 'connect':
      showConnectRequest();
      break;
    case 'transaction':
      showTransactionRequest();
      break;
    case 'sign':
      showSignRequest();
      break;
  }

  bindEvents();
}

// 显示连接请求
function showConnectRequest() {
  document.getElementById('connectRequest').classList.remove('hidden');
  document.getElementById('connectOrigin').textContent = requestData.origin;
}

// 显示交易请求
function showTransactionRequest() {
  document.getElementById('transactionRequest').classList.remove('hidden');
  document.getElementById('txOrigin').textContent = requestData.origin;

  const tx = requestData.transaction;
  document.getElementById('txTo').textContent = tx.to || '合约创建';
  document.getElementById('txValue').textContent =
    ethers.utils.formatEther(tx.value || '0') + ' ETH';
  document.getElementById('txGasLimit').textContent = tx.gasLimit || '自动';
  document.getElementById('txGasPrice').textContent =
    tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, 'gwei') + ' Gwei' : '自动';

  if (tx.data && tx.data !== '0x') {
    document.getElementById('txDataRow').style.display = 'flex';
    document.getElementById('txData').textContent =
      tx.data.substring(0, 20) + '...';
  }
}

// 显示签名请求
function showSignRequest() {
  document.getElementById('signRequest').classList.remove('hidden');
  document.getElementById('signOrigin').textContent = requestData.origin;

  let message = requestData.message;
  // 如果是十六进制，尝试转换
  if (message.startsWith('0x')) {
    try {
      message = ethers.utils.toUtf8String(message);
    } catch (e) {
      // 保持原样
    }
  }

  document.getElementById('signMessage').textContent = message;
}

// 绑定事件
function bindEvents() {
  // 连接请求
  document.getElementById('approveConnect')?.addEventListener('click', async () => {
    await approveConnect();
  });

  document.getElementById('rejectConnect')?.addEventListener('click', () => {
    reject();
  });

  // 交易请求
  document.getElementById('approveTx')?.addEventListener('click', async () => {
    await approveTransaction();
  });

  document.getElementById('rejectTx')?.addEventListener('click', () => {
    reject();
  });

  // 签名请求
  document.getElementById('approveSign')?.addEventListener('click', async () => {
    await approveSign();
  });

  document.getElementById('rejectSign')?.addEventListener('click', () => {
    reject();
  });
}

// 批准连接
async function approveConnect() {
  try {
    showStatus('正在连接...', 'info');
    // 获取钱包地址
    const session = await chrome.storage.session.get('wallet_address');
    const address = session.wallet_address;

    if (!address) {
      throw new Error('钱包未解锁');
    }

    // 🔥 保存授权（传递地址）
    const result = await chrome.storage.local.get('authorizations');
    const authorizations = result.authorizations || {};

    authorizations[requestData.origin] = {
      address: address,
      timestamp: Date.now()
    };

    await chrome.storage.local.set({ authorizations });

    console.log('✅ Authorization saved:', requestData.origin, address);

    // 发送批准响应
    chrome.runtime.sendMessage({
      type: 'APPROVAL_RESPONSE',
      requestId: requestData.requestId,
      approved: true,
      result: [address]
    });

    showStatus('连接成功！', 'success');

    setTimeout(() => {
      window.close();
    }, 1000);

  } catch (error) {
    console.error('批准连接失败:', error);
    showStatus('连接失败: ' + error.message, 'error');
  }
}

// 批准交易
async function approveTransaction() {
  if (isProcessing) return;
  isProcessing = true;

  const btn = document.getElementById('approveTx');
  btn.disabled = true;
  btn.textContent = '发送中...';

  try {
    showStatus('正在发送交易...', 'info');

    const txHash = await chrome.runtime.sendMessage({
      type: 'SEND_TRANSACTION',
      transaction: requestData.transaction
    });

    await chrome.runtime.sendMessage({
      type: 'APPROVAL_RESPONSE',
      requestId,
      approved: true,
      result: txHash
    });

    showStatus('交易已发送！', 'success');
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    showStatus('交易失败: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = '确认';
    isProcessing = false;
  }
}

// 批准签名
async function approveSign() {
  if (isProcessing) return;

  isProcessing = true;

  const btn = document.getElementById('approveSign');
  btn.disabled = true;
  btn.textContent = '签名中...';

  try {
    showStatus('正在签名...', 'info');

    const signature = await chrome.runtime.sendMessage({
      type: 'SIGN_MESSAGE',
      message: requestData.message,
      address: requestData.address
    });

    await chrome.runtime.sendMessage({
      type: 'APPROVAL_RESPONSE',
      requestId,
      approved: true,
      result: signature
    });

    showStatus('签名成功！', 'success');
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    showStatus('签名失败: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = '签名';
    isProcessing = false;
  }
}

// 拒绝请求
async function reject() {
  await chrome.runtime.sendMessage({
    type: 'APPROVAL_RESPONSE',
    requestId,
    approved: false
  });

  window.close();
}

// 显示状态
function showStatus(message, type) {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
  statusEl.style.display = 'block';
}

// 启动
init();
