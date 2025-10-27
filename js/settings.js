const Settings = {
  // 加载已授权网站
  async loadAuthorizedSites() {
    const listEl = document.getElementById('authorizedSitesList');
    try {
      const authorizations = await Storage.getAllAuthorizations();

      if (Object.keys(authorizations).length === 0) {
        listEl.innerHTML = '<div class="empty-message">暂无授权网站</div>';
        return;
      }

      listEl.innerHTML = Object.entries(authorizations).map(([origin, data]) => `
        <div class="authorized-site-item">
          <div class="site-details">
            <div class="site-origin">🌐 ${origin}</div>
            <div class="site-address">${data.address.substring(0, 10)}...${data.address.substring(38)}</div>
            <div class="site-time">${new Date(data.timestamp).toLocaleString('zh-CN')}</div>
          </div>
          <button class="btn-revoke" data-origin="${origin}">
            撤销
          </button>
        </div>
      `).join('');

      // 绑定撤销按钮事件
      listEl.querySelectorAll('.btn-revoke').forEach(btn => {
        btn.addEventListener('click', () => {
          this.revokeAuthorization(btn.dataset.origin);
        });
      });
    } catch (error) {
      console.error('加载授权网站失败:', error);
      listEl.innerHTML = '<div class="empty-message">加载失败</div>';
    }
  },

  // 撤销单个授权
  async revokeAuthorization(origin) {
    if (!confirm(`确定要撤销 ${origin} 的授权吗？`)) {
      return;
    }
    
    try {
      const success = await Storage.revokeAuthorization(origin);
      if (success) {
        UI.showToast('授权已撤销', 'success');
        await this.loadAuthorizedSites();
      } else {
        UI.showToast('撤销失败', 'error');
      }
    } catch (error) {
      console.error('撤销授权失败:', error);
      UI.showToast('撤销失败: ' + error.message, 'error');
    }
  },

  // 清除所有授权
  async clearAllAuthorizations() {
    if (!confirm('确定要清除所有授权吗？此操作不可恢复。')) {
      return;
    }

    try {
      await Storage.clearAllAuthorizations();
      UI.showToast('已清除所有授权', 'success');
      await this.loadAuthorizedSites();
    } catch (error) {
      console.error('清除授权失败:', error);
      UI.showToast('清除失败: ' + error.message, 'error');
    }
  }
};