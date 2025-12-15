// 工具函数模块
const Utils = {
  // 转义HTML
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 缩短地址显示
  shortenAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  },

  // 复制到剪贴板
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      UI.showToast('已复制到剪贴板', 'success', 1000);
    } catch (error) {
      // 备用方法
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      UI.showToast('已复制到剪贴板', 'success', 1000);
    }
  },

  // 生成基于地址的头像（Identicon 风格）
  generateAvatar(address) {
    const canvas = document.createElement('canvas');
    const size = 48;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 使用地址生成颜色和图案
    const hash = address.slice(2); // 移除 '0x'

    // 生成背景渐变色
    const color1 = '#' + hash.slice(0, 6);
    const color2 = '#' + hash.slice(6, 12);

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // 生成图案（5x5 网格，对称）
    const gridSize = 5;
    const cellSize = size / gridSize;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < Math.ceil(gridSize / 2); j++) {
        const index = i * Math.ceil(gridSize / 2) + j;
        const hashValue = parseInt(hash.charAt(index % hash.length), 16);

        if (hashValue % 2 === 0) {
          // 左侧
          ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
          // 右侧对称
          if (j !== Math.floor(gridSize / 2)) {
            ctx.fillRect((gridSize - 1 - j) * cellSize, i * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    return canvas;
  },

  // 生成二维码
  generateQRCode(text, elementId) {
    const qrcodeDiv = document.getElementById(elementId);
    qrcodeDiv.innerHTML = ''; // 清空之前的内容

    try {
      new QRCode(qrcodeDiv, {
        text: text,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (error) {
      console.error('生成二维码失败:', error);
      qrcodeDiv.innerHTML = `
        <div style="
          width: 200px; 
          height: 200px; 
          background: #f0f0f0; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 11px;
          text-align: center;
          padding: 10px;
          word-break: break-all;
          color: #666;
        ">
          ${text}
        </div>
      `;
    }
  },

  // 使用密码加密
  async encryptString(text, password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // 生成密钥
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    // 生成盐值
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // 派生加密密钥
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // 生成 IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 加密
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    // 组合: salt(16) + iv(12) + encrypted
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    // 转换为 Base64
    return btoa(String.fromCharCode(...result));
  },

  // 解密字符串
  async decryptString(encryptedBase64, password) {
    try {
      // Base64 解码
      const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

      // 提取 salt, iv, data
      const salt = encrypted.slice(0, 16);
      const iv = encrypted.slice(16, 28);
      const data = encrypted.slice(28);

      const encoder = new TextEncoder();

      // 生成密钥
      const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      // 派生解密密钥
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: 100000,
          hash: 'SHA-256'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      // 解密
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
      );

      // 转换为字符串
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);

    } catch (error) {
      console.error('❌ Decrypt failed:', error);
      throw new Error('密码错误或数据损坏');
    }
  },
};
