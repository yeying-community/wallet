# 官方资产图标来源

这些文件来自网络/发行方的官方品牌资源页面，仅作为本地资源候选，尚未接入钱包的资产注册表。

| 文件 | 资产 | 来源 | 说明 |
| --- | --- | --- | --- |
| `ethereum.svg` | ETH | https://ethereum.org/images/assets/svgs/eth-diamond-glyph.svg | Ethereum 官方资产图标 |
| `polygon-lockup.svg` | Polygon / POL | https://polygon.technology/brand-guidelines | Polygon 官方品牌锁定图，包含图形和文字，接入圆形代币图标前应改用官方 symbol 版本 |
| `bnb-chain.png` | BNB Chain | https://static.bnbchain.org/home-ui/static/images/brand-guidelines/logo.png | BNB Chain 官方品牌图，当前是横向品牌图，不直接作为圆形代币图标 |
| `usdc.svg` | USDC | https://www.circle.com/pressroom | Circle 官方 USDC Token 图标 |
| `usdt.svg` | USDT | https://tether.io/press/brand-assets/ | Tether 官方 USDT Token 图标 |

## 尚未下载

- TRX：TRON 官方资源页当前无法稳定取得可直接引用的单色/方形图标，暂不使用第三方替代素材。
- YYT：需要 YeYing 项目确认并提供官方品牌图标后再加入。

## 接入规则

- 图标键必须使用 `chainKey + contractAddress`，不能只按 symbol 匹配。
- 本地资源优先于 DApp 传入的远程 `image`。
- DApp 传入的图标只能作为未验证预览，不能标记为官方图标。
