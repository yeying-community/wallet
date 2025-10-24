// 工具函数模块
const Utils = {
  // 缩短地址显示
  shortenAddress(address) {
    return address.substring(0, 6) + '...' + address.substring(address.length - 4);
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
  }
};
