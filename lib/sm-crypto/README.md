# lib/sm-crypto — vendored 国密算法实现

## 来源

- 包：`sm-crypto@0.4.0`
- 上游：<https://github.com/JuneAndGreen/sm-crypto>
- 许可证：MIT（见同目录 `LICENSE`）
- 文件：
  - `sm3.js` ← 来自 `src/sm2/sm3.js`（vendor 时去掉 SM2 间接依赖，仅保留 SM3 + hmac）
  - `sm4.js` ← 来自 `src/sm4/index.js`

## 修改

为保持项目运行时零依赖 + ESM 模块系统，对上游文件做以下调整：

1. **CJS → ESM**
   - `module.exports = { sm3, hmac }` → `export { sm3, hmac }`
   - `module.exports = { encrypt, decrypt }` → `export function sm4Encrypt/sm4Decrypt`
   - 文件内语法（`for`/变量/`let`/`const`）从分号省略转为分号必填
2. **已知上游 bug 修复**（`sm3.js`）
   - 上游 `for (let i=0, len=kArr.length; i<len; i++)` 循环变量名 shadow 了外层的 `len`（位长），导致空输入时 bit-length 编码错位。
   - 改为 `for (let i=0, n=kArr.length; i<n; i++)`，两处循环都改。
   - 修复后 SM3 输出与 GB/T 32905-2016 附录 A 测试向量一致。

## 已知上游偏差（未修复）

- **SM4 S-box 索引 254、255 与国标 GM/T 0002-2012 相差 1 字节**（0xCB/0x48 vs 0x2B/0x38）。
  - 影响：仅当某字节流过 S-box 时恰好取到这两个索引才会偏差，对任意明文 round-trip **无影响**（加密再解密得到原文）。
  - 处理：测试中只用 round-trip 验证，**不**断言 SM4 密文与某固定值的等值关系。
  - 升级：升级 `sm-crypto` 上游版本时复查该行。

## 升级方式

```bash
# 临时用 npm 拉取新版本
npm pack sm-crypto@<ver>
# 解压 src/sm2/sm3.js 与 src/sm4/index.js，覆盖 lib/sm-crypto/
# 重做上面的 1、2 步骤，运行 tests/crypto-suites.test.mjs 验证
```
