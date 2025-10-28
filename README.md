# 客户端浏览器插件

## 本地插件安装

1. 克隆代码到本地
2. 在浏览器中输入：chrome://extensions/
3. 打开右上角“开发者模式”开关
4. 点击“加载未打包的扩展程序”，并指定代码目录，即完成安装


## 功能说明

✅ 已实现功能：

- 创建新钱包
- 导入钱包（通过私钥）
- 查看余额
- 发送交易
- 切换网络（主网/测试网）
- 导出私钥
- 复制地址
- 密码保护
- 交易历史记录
- 更好的二维码生成

🔧 可扩展功能：
- 添加助记词支持
- 代币支持（ERC-20）
- 多账户管理

## 下载依赖包

curl -o ethers-5.7.umd.min.js https://unpkg.com/ethers@5.7.2/dist/ethers.umd.min.js
curl -o qrcode.min.js https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js
