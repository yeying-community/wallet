importScripts('lib/ethers-5.7.umd.min.js');
importScripts('js/indexeddb.js');

const pendingRequests = new Map();
const connections = new Map();

// 监听来自 content script 的连接
chrome.runtime.onConnect.addListener((port) => {
  console.log('📥 New connection:', port.name, 'from tab:', port.sender?.tab?.id);

  if (port.name === 'yeying-wallet') {
    const tabId = port.sender?.tab?.id;

    if (tabId) {
      connections.set(tabId, port);
      port.onDisconnect.addListener(() => {
        console.log('📤 Connection disconnected:', tabId);
        connections.delete(tabId);
      });

      port.onMessage.addListener(async (message) => {
        console.log('📨 Received message:', message.method, 'from tab:', tabId);

        try {
          const result = await handleRequest(message, port.sender);

          port.postMessage({
            requestId: message.requestId,
            result: result
          });
        } catch (error) {
          console.error('❌ Handle message error:', error);

          port.postMessage({
            requestId: message.requestId,
            error: error.message
          });
        }
      });
    } else {
      console.warn('⚠️ Connection without tab ID');
    }
  }
});

// 监听来自 approval 页面的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📬 Runtime message:', message.type);

  // 处理解锁成功
  if (message.type === 'UNLOCK_SUCCESS') {
    handleUnlockSuccess(message)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('处理解锁成功失败:', error);
        sendResponse({ error: error.message });
      });
    return true; // 保持消息通道开放
  }

  // 处理解锁取消
  if (message.type === 'UNLOCK_CANCELLED') {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      pending.reject(new Error('User cancelled unlock'));
      pendingRequests.delete(message.requestId);
    }
    sendResponse({ success: true });
    return;
  }

  handleApprovalMessage(message)
    .then(sendResponse)
    .catch(error => {
      console.error('❌ Approval message error:', error);
      sendResponse({ error: error.message });
    });

  return true; // 保持消息通道开放
});

// 处理解锁成功
async function handleUnlockSuccess(message) {
  const { requestId, address, origin } = message;

  console.log('🔓 Unlock success:', { requestId, address, origin });

  const pending = pendingRequests.get(requestId);

  if (!pending) {
    console.warn('⚠️ No pending request found for:', requestId);
    return;
  }
  // 检查是否已授权
  const authorized = await checkAuthorization(origin);

  if (authorized) {
    // 已授权，直接返回地址
    console.log('✅ Already authorized, returning address');
    pending.resolve([address]);
    pendingRequests.delete(requestId);
    return [address];
  }

  // 未授权，显示授权弹窗
  console.log('🔐 Not authorized, showing approval popup');
  chrome.windows.create({
    url: `html/approval.html?type=connect&requestId=${requestId}`,
    type: 'popup',
    width: 380,
    height: 600,
    focused: true
  }, (window) => {
    if (!window) {
      pending.reject(new Error('Failed to open approval window'));
      pendingRequests.delete(requestId);
    }
  });
}

// 处理来自 content script 的消息
async function handleRequest(message, sender) {
  const { method, params } = message;

  console.log('🔧 Handling method:', method);

  switch (method) {
    case 'eth_requestAccounts':
      return await handleConnectRequest(sender);

    case 'eth_accounts':
      return await getAccounts(sender);

    case 'eth_chainId':
      return await getChainId();

    case 'eth_getBalance':
      return await getBalance(params[0]);

    case 'eth_sendTransaction':
      return await handleSendTransaction(params[0], sender);

    case 'personal_sign':
      return await handlePersonalSign(params[0], params[1], sender);

    case 'eth_signTypedData_v4':
      return await handleSignTypedData(params[1], params[0], sender);

    // 撤销权限, wallet_revokePermissions 是 EIP-2255 提案中的方法
    case 'wallet_revokePermissions':
      return handleRevokePermissions(params, origin);

    // 获取权限（可选，用于查询当前权限）
    case 'wallet_getPermissions':
      return handleGetPermissions(origin);

    // 请求权限（可选，标准化的权限请求）
    case 'wallet_requestPermissions':
      return handleRequestPermissions(params, origin);

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

// 处理来自 approval 页面的消息
async function handleApprovalMessage(message) {
  switch (message.type) {
    case 'GET_REQUEST_DETAILS':
      const pending = pendingRequests.get(message.requestId);
      return { data: pending };

    case 'SAVE_AUTHORIZATION':
      await saveAuthorization(message.origin);
      return { success: true };

    case 'GET_WALLET_ADDRESS':
      return await getWalletAddress();

    case 'SEND_TRANSACTION':
      return await sendTransaction(message.transaction);

    case 'SIGN_MESSAGE':
      return await signMessage(message.message, message.address);

    case 'APPROVAL_RESPONSE':
      handleApprovalResponse(message);
      return { success: true };

    default:
      throw new Error('Unknown message type: ' + message.type);
  }
}

// 处理连接请求
async function handleConnectRequest(sender) {
  console.log('🔐 handleConnectRequest called');

  const tab = sender.tab;
  if (!tab || !tab.url) {
    throw new Error('Invalid sender');
  }

  const origin = new URL(tab.url).origin;
  const requestId = `connect_${Date.now()}`;

  // 检查钱包是否解锁
  const session = await chrome.storage.session.get('wallet_address');

  if (!session.wallet_address) {
    console.log('🔒 Wallet is locked, opening unlock popup');

    // 先保存连接请求
    pendingRequests.set(requestId, {
      resolve: null,
      reject: null,
      origin,
      tabId: tab.id,
      type: 'connect',
      needsUnlock: true
    });

    // 打开解锁弹窗
    return new Promise((resolve, reject) => {
      const pending = pendingRequests.get(requestId);
      pending.resolve = resolve;
      pending.reject = reject;

      chrome.windows.create({
        url: `html/popup.html?action=unlock&requestId=${requestId}&origin=${encodeURIComponent(origin)}`,
        type: 'popup',
        width: 380,
        height: 600,
        focused: true
      }, (window) => {
        if (!window) {
          pendingRequests.delete(requestId);
          reject(new Error('Failed to open unlock window'));
        }
      });

      // 超时处理
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error('Unlock timeout'));
        }
      }, 300000);
    });
  }

  // 钱包已解锁，检查是否已授权
  const authorized = await checkAuthorization(origin);
  console.log('🔑 Already authorized:', authorized);

  if (authorized) {
    const address = await getWalletAddress();
    console.log('✅ Returning address:', address);
    return [address];
  }

  // 需要授权，显示授权弹窗
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      origin,
      tabId: tab.id,
      type: 'connect'
    });

    chrome.windows.create({
      url: `html/approval.html?type=connect&requestId=${requestId}`,
      type: 'popup',
      width: 380,
      height: 600,
      focused: true
    });

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 300000);
  });
}

// 处理发送交易
async function handleSendTransaction(transaction, sender) {
  const tab = sender.tab;
  if (!tab || !tab.url) {
    throw new Error('Invalid sender');
  }

  const origin = new URL(tab.url).origin;
  const requestId = `tx_${Date.now()}`;

  // 检查授权
  const authorized = await checkAuthorization(origin);
  if (!authorized) {
    throw new Error('Not authorized');
  }

  // 显示交易确认弹窗
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      transaction,
      origin,
      tabId: tab.id,
      type: 'transaction'
    });

    chrome.windows.create({
      url: `html/approval.html?type=transaction&requestId=${requestId}`,
      type: 'popup',
      width: 380,
      height: 650,
      focused: true
    });

    // 超时处理
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 300000);
  });
}

// 处理个人签名
async function handlePersonalSign(message, address, sender) {
  const tab = sender.tab;
  if (!tab || !tab.url) {
    throw new Error('Invalid sender');
  }

  const origin = new URL(tab.url).origin;
  const requestId = `sign_${Date.now()}`;

  const authorized = await checkAuthorization(origin);
  if (!authorized) {
    throw new Error('Not authorized');
  }

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      message,
      address,
      origin,
      tabId: tab.id,
      type: 'sign'
    });

    chrome.windows.create({
      url: `html/approval.html?type=sign&requestId=${requestId}`,
      type: 'popup',
      width: 380,
      height: 600,
      focused: true
    });

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 300000);
  });
}

// 处理类型化数据签名
async function handleSignTypedData(typedData, address, sender) {
  const tab = sender.tab;
  if (!tab || !tab.url) {
    throw new Error('Invalid sender');
  }
  const origin = new URL(tab.url).origin;
  const requestId = `signTypedData_${Date.now()}`;

  const authorized = await checkAuthorization(origin);
  if (!authorized) {
    throw new Error('Not authorized');
  }

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      typedData: typeof typedData === 'string' ? JSON.parse(typedData) : typedData,
      address,
      origin,
      tabId: tab.id,
      type: 'signTypedData'
    });

    chrome.windows.create({
      url: `html/approval.html?type=sign&requestId=${requestId}`,
      type: 'popup',
      width: 380,
      height: 600,
      focused: true
    });

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 300000);
  });
}

// 获取链 ID
async function getChainId() {
  const result = await chrome.storage.local.get('selectedNetwork');
  const network = result.selectedNetwork || 'yeying';

  const chainIds = {
    'mainnet': '0x1',
    'sepolia': '0xaa36a7',
    'goerli': '0x5',
    'yeying': '0x1538',
  };

  return chainIds[network] || '0x1538';
}

// 获取账户列表
async function getAccounts(sender) {
  const session = await chrome.storage.session.get('wallet_address');

  if (!session.wallet_address) {
    return [];
  }

  // 检查是否授权
  if (sender && sender.tab && sender.tab.url) {
    const origin = new URL(sender.tab.url).origin;
    const authorized = await checkAuthorization(origin);

    if (!authorized) {
      return [];
    }
  }

  return [session.wallet_address];
}

// 获取余额
async function getBalance(address) {
  try {
    const network = await getSelectedNetwork();
    const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);

    const balance = await provider.getBalance(address);
    return balance.toHexString();
  } catch (error) {
    console.error('Get balance error:', error);
    throw error;
  }
}

// 检查授权
async function checkAuthorization(origin) {
  try {
    const result = await chrome.storage.local.get('authorizations');
    const authorizations = result.authorizations || {};
    const isAuthorized = !!authorizations[origin];
    console.log('🔍 Check authorization:', origin, isAuthorized);
    return isAuthorized;
  } catch (error) {
    console.error('检查授权失败:', error);
    return false;
  }
}

// 保存授权
async function saveAuthorization(origin, address) {
  try {
    const result = await chrome.storage.local.get('authorizations');
    const authorizations = result.authorizations || {};

    authorizations[origin] = {
      address: address,
      timestamp: Date.now()
    };
    await chrome.storage.local.set({ authorizations });
    console.log('✅ Authorization saved:', origin, address);
    return true;
  } catch (error) {
    console.error('保存授权失败:', error);
    return false;
  }
}

// 获取钱包地址
async function getWalletAddress() {
  const result = await chrome.storage.local.get(['web3_wallet_encrypted', 'web3_wallet_expire_time']);

  if (!result.web3_wallet_encrypted) {
    throw new Error('No wallet found');
  }

  // 检查是否过期
  if (result.web3_wallet_expire_time && Date.now() > result.web3_wallet_expire_time) {
    throw new Error('Session expired');
  }

  // 从 session storage 获取临时解密的地址
  const session = await chrome.storage.session.get('wallet_address');
  if (session.wallet_address) {
    return session.wallet_address;
  }

  throw new Error('Wallet locked');
}

// 发送交易
async function sendTransaction(transaction) {
  try {
    const session = await chrome.storage.session.get('wallet_privateKey');
    if (!session.wallet_privateKey) {
      throw new Error('Wallet locked');
    }

    const wallet = new ethers.Wallet(session.wallet_privateKey);
    const network = await getSelectedNetwork();
    const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
    const connectedWallet = wallet.connect(provider);

    // 准备交易参数
    const txParams = {
      to: transaction.to,
      value: transaction.value || '0x0',
      data: transaction.data || '0x',
      gasLimit: transaction.gas || transaction.gasLimit,
      gasPrice: transaction.gasPrice,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      nonce: transaction.nonce
    };

    // 发送交易
    const tx = await connectedWallet.sendTransaction(txParams);

    // 保存交易记录
    await saveTransactionHistory({
      hash: tx.hash,
      from: wallet.address,
      to: transaction.to,
      value: transaction.value || '0x0',
      timestamp: Date.now(),
      status: 'pending',
      network: network.name
    });

    // 监听交易确认
    tx.wait().then(receipt => {
      updateTransactionStatus(tx.hash, receipt.status === 1 ? 'success' : 'failed');
    }).catch(error => {
      console.error('Transaction failed:', error);
      updateTransactionStatus(tx.hash, 'failed');
    });

    return tx.hash;
  } catch (error) {
    console.error('Send transaction error:', error);
    throw error;
  }
}

// 保存交易历史
async function saveTransactionHistory(txData) {
  try {
    // 确保数据格式统一
    const transaction = {
      hash: txData.hash,
      from: txData.from,
      to: txData.to,
      value: txData.value,
      timestamp: txData.timestamp || Date.now(),
      status: txData.status || 'pending',
      network: txData.network,
      source: txData.source || 'dapp' // 标记来源
    };

    await IndexedDB.saveTransaction(transaction)

    console.log('✅ Transaction saved to history:', transaction.hash);

    return true;
  } catch (error) {
    console.error('❌ Save transaction history failed:', error);
    return false;
  }
}


// 更新交易状态
async function updateTransactionStatus(hash, status) {
  try {
    await IndexedDB.updateTransactionStatus(hash, status);
    console.log('✅ Transaction status updated:', hash, status);
    return true;
  } catch (error) {
    console.error('❌ Update transaction status failed:', error);
    return false;
  }
}

// 签名消息
async function signMessage(message, address) {
  try {
    const session = await chrome.storage.session.get('wallet_privateKey');
    if (!session.wallet_privateKey) {
      throw new Error('Wallet locked');
    }

    const wallet = new ethers.Wallet(session.wallet_privateKey);

    // 验证地址匹配
    if (wallet.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error('Address mismatch');
    }

    // 签名
    const signature = await wallet.signMessage(
      message.startsWith('0x') ? ethers.utils.arrayify(message) : message
    );

    return signature;
  } catch (error) {
    console.error('Sign message error:', error);
    throw error;
  }
}

// 获取选中的网络
async function getSelectedNetwork() {
  const result = await chrome.storage.local.get('selectedNetwork');
  const networkName = result.selectedNetwork || 'yeying';

  const networks = {
    'mainnet': {
      name: 'Ethereum Mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
      chainId: 1
    },
    'sepolia': {
      name: 'Sepolia Testnet',
      rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY',
      chainId: 11155111
    },
    'yeying': {
      name: 'YeYing Mainnet',
      rpcUrl: 'https://blockchain.yeying.pub',
      chainId: 5432
    }
  };

  return networks[networkName] || networks.yeying;
}

// 处理授权响应
function handleApprovalResponse(message) {
  const { requestId, approved, result } = message;
  const pending = pendingRequests.get(requestId);

  if (pending) {
    if (approved) {
      pending.resolve(result);
    } else {
      pending.reject(new Error('User rejected request'));
    }

    pendingRequests.delete(requestId);
  } else {
    console.warn('⚠️ No pending request found for:', requestId);
  }
}

// 🔥 处理撤销权限
async function handleRevokePermissions(params, origin) {
  console.log('🔓 Revoking permissions for:', origin);

  try {
    // 参数格式: [{ eth_accounts: {} }]
    if (!params || !params[0]) {
      throw new Error('Invalid params for wallet_revokePermissions');
    }

    const permissions = params[0];

    // 检查是否要撤销 eth_accounts 权限
    if (permissions.eth_accounts !== undefined) {
      // 从存储中移除授权
      const result = await chrome.storage.local.get('authorizedOrigins');
      const authorizedOrigins = result.authorizedOrigins || {};

      if (authorizedOrigins[origin]) {
        delete authorizedOrigins[origin];
        await chrome.storage.local.set({ authorizedOrigins });

        console.log('✅ Permissions revoked for:', origin);

        // 触发 accountsChanged 事件，返回空数组
        notifyAccountsChanged(origin, []);

        return null; // 成功返回 null
      } else {
        console.log('⚠️ No permissions found for:', origin);
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Revoke permissions error:', error);
    throw error;
  }
}

// 🔥 获取当前权限
async function handleGetPermissions(origin) {
  console.log('📋 Getting permissions for:', origin);

  try {
    const result = await chrome.storage.local.get('authorizedOrigins');
    const authorizedOrigins = result.authorizedOrigins || {};

    if (authorizedOrigins[origin]) {
      // 返回权限列表
      return [
        {
          id: generatePermissionId(),
          parentCapability: 'eth_accounts',
          invoker: origin,
          caveats: [
            {
              type: 'restrictReturnedAccounts',
              value: [authorizedOrigins[origin].address]
            }
          ],
          date: authorizedOrigins[origin].timestamp
        }
      ];
    }

    return []; // 没有权限
  } catch (error) {
    console.error('❌ Get permissions error:', error);
    throw error;
  }
}

// 🔥 请求权限（标准化方式）
async function handleRequestPermissions(params, origin) {
  console.log('🔐 Requesting permissions:', params);

  try {
    // 参数格式: [{ eth_accounts: {} }]
    if (!params || !params[0] || !params[0].eth_accounts) {
      throw new Error('Invalid params for wallet_requestPermissions');
    }

    // 实际上就是请求账户访问权限
    // 复用 eth_requestAccounts 的逻辑
    const accounts = await handleRequestAccounts(origin);

    // 返回权限对象
    return [
      {
        id: generatePermissionId(),
        parentCapability: 'eth_accounts',
        invoker: origin,
        caveats: [
          {
            type: 'restrictReturnedAccounts',
            value: accounts
          }
        ],
        date: Date.now()
      }
    ];
  } catch (error) {
    console.error('❌ Request permissions error:', error);
    throw error;
  }
}

// 🔥 生成权限 ID
function generatePermissionId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 🔥 通知账户变更（用于撤销权限后）
function notifyAccountsChanged(origin, accounts) {
  console.log('📢 Notifying accounts changed:', origin, accounts);

  // 查找所有来自该 origin 的标签页
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.url && tab.url.startsWith(origin)) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ACCOUNTS_CHANGED',
          accounts: accounts
        }).catch(err => {
          console.log('Failed to notify tab:', tab.id, err);
        });
      }
    });
  });
}

console.log('✅ YeYing Wallet background script loaded');
