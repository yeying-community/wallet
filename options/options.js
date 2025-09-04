document.addEventListener('DOMContentLoaded', function () {
  // 获取网络选择和主题选择的元素
  const networkSelect = document.getElementById('network');
  const themeSelect = document.getElementById('theme');
  const saveButton = document.getElementById('saveButton');

  // 从 localStorage 获取用户的设置
  const savedNetwork = localStorage.getItem('network') || 'ethereum'; // 默认值：ethereum
  const savedTheme = localStorage.getItem('theme') || 'dark'; // 默认值：dark

  // 设置默认选择项
  networkSelect.value = savedNetwork;
  themeSelect.value = savedTheme;

  // 保存设置到 localStorage
  saveButton.addEventListener('click', function () {
    const selectedNetwork = networkSelect.value;
    const selectedTheme = themeSelect.value;

    localStorage.setItem('network', selectedNetwork);
    localStorage.setItem('theme', selectedTheme);

    alert('设置已保存!');
  });
});
