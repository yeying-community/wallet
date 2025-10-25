const Settings = {
  // 加载已授权网站
  async loadAuthorizedSites() {
    const result = await chrome.storage.local.get('authorizedSites');
    const sites = result.authorizedSites || [];
    
    const listEl = document.getElementById('authorizedSitesList');
    
    if (sites.length === 0) {
      listEl.innerHTML = '<p style="color: #999;">暂无授权网站</p>';
      return;
    }

    listEl.innerHTML = sites.map(site => `
      <div class="authorized-site">
        <div class="site-info">
          <span class="site-icon">🌐</span>
          <span class="site-url">${site}</span>
        </div>
        <button onclick="Settings.revokeAuthorization('${site}')" 
                class="btn-revoke">撤销</button>
      </div>
    `).join('');
  },

  // 撤销授权
  async revokeAuthorization(site) {
    if (!confirm(`确定要撤销 ${site} 的授权吗？`)) {
      return;
    }
    
    const result = await chrome.storage.local.get('authorizedSites');
    const sites = result.authorizedSites || [];
    
    const newSites = sites.filter(s => s !== site);
    await chrome.storage.local.set({ authorizedSites: newSites });

    UI.showToast('授权已撤销', 'success');
    this.loadAuthorizedSites();
  },

  // 清除所有授权
  async clearAllAuthorizations() {
    if (!confirm('确定要清除所有网站的授权吗？')) {
      return;
    }

    await chrome.storage.local.set({ authorizedSites: [] });
    UI.showToast('已清除所有授权', 'success');
    this.loadAuthorizedSites();
  }
};

// 在页面加载时调用
document.addEventListener('DOMContentLoaded', () => {
  Settings.loadAuthorizedSites();
});
