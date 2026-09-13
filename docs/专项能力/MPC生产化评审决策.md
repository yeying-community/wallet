# MPC 钱包 —— 撤回"实验性 / 不承载生产资产"硬约束(决策初稿)

> 状态: **决策草案待评审** —— 仅取消 2026-08-08 "保持实验性、不承载生产资产、不进入生产签名路径" 的**前置禁令**,明确进入生产评审阶段。**§16.1、§16.2 留待事实状态 + §2 9 项准入条件均未完成**,本文不构成"已通过生产化评审"的结论。
>
> 决策日期: 待定(用户确认日期后填入)
>
> 适用范围: Wallet、MPC Coordinator、`opensource/node`、业务接入方

## 0. 本文做了什么 / 没做什么

**做了**:
- 取消 §2 "当前 MPC 能力保持实验性,不用于承载或承诺生产资产安全" 句。
- 取消 §2 "不得接收生产资产,也不得进入生产交易签名路径" 句。
- 取消 §16.1 中"生产化前必须完成以下任一方案,并移除 `dev-verification` profile" 的硬时间要求。
- 保留 §2 中所有准入条件(§2 第 61-72 行 9 项)。
- 保留 §16.1 中关于"生产参数下 Aux-info 在浏览器 WASM 中可能运行数分钟"的工程提示。
- 保留 §16.2 调试快照的全部历史记录,标注"截至 2026-09-11 的补充观测"。

**没做**:
- **未撤销 `_completeKeyShareFromDevTrustedAuxInfo` dev 逃生口** —— 该路径在 dev-verification build 下仍可能被触发,见 §3。
- **未切换 productionSafe WASM build** —— 当前 `js/background/wasm/cggmp24/mpc_cggmp24_spike.wasm` 仍为 `securityProfile: 'dev-verification'` + `productionSafe: false`。
- **未完成 §16.2 留待下次的 7 项** —— offscreen/worker 的终态收敛、持久化字段、双方代际重试的真机端到端验收未做。
- **未做独立安全审计** —— §2 第 9 项准入条件未满足。
- **未做多实现/多设备互操作测试** —— §2 第 3 项未满足。
- **未做密钥分片加密存储、备份、恢复、迁移、轮换和销毁流程** —— §2 第 5 项未满足。
- **未做参与者身份绑定、设备替换、成员增加和移除的安全协议** —— §2 第 6 项未满足。
- **未做高风险问题全关 + 书面风险接受记录** —— §2 第 9 项未满足。

## 1. 决策正文

承接 §2 决策日期 2026-08-08 起的实验性约束,本文基于以下事实:

- commit `1a55ac6` 在 dev-verification build 上实现 6→4 并行素数生成,真机 Chrome P 核 caffeinate 3 轮交错验证:中位 **34.9s**,最坏 **66.6s**(朴素 max-of-4 中位 118.2s、最坏 130.8s;serial 基线 120.7s)。该 build 下 `newWithPrimes` 端到端可用。
- commit `8220e11` 实现 aux-info 收敛:10 min deadline + 3 代代际重试 + 1 min watchdog alarm;fanout 失败自动进 `wire-aux-info-start-skipped` 审计 + `cggmp24:aux-prime-fanout` debug log。

**因此**:
- 解除 "不得接收生产资产"、"不得进入生产交易签名路径" 的前置禁令。
- 进入"生产评审"阶段:工程上已具备稳定启动 dev-verification build 的能力,允许在受控环境下推进下一阶段验收。

**仍然禁止**(在 §2 准入条件全部满足且形成新安全评审结论前):

- 在没有真机 2-of-2 签名验证 ECDSA 与钱包地址匹配之前,不得用于真实资金钱包。
- 不得对外宣称当前实现已达到生产级门限钱包安全。
- 不得在没有独立安全审计的前提下,将本仓库的 release artifact 部署到面向终端用户的应用商店。
- 不得在没有 §2 第 3-6 项验收结论的前提下,以默认启用方式向用户展示 MPC 钱包为推荐钱包类型。

## 2. §16.1 补充观测(2026-09-11)

承接 2026-08-25 §16.2 调试快照。本节追加截至本文起草时的观测结论:

- **当前 `.wasm` build 仍为 `dev-verification`**(`securityProfile: 'dev-verification'` + `productionSafe: false`),该 build 在 commit `1a55ac6` 之前会走 SW 端 `_completeKeyShareFromDevTrustedAuxInfo` 逃生口,**直接伪造 aux-info,不调真 wire 协议**。
- commit `1a55ac6` 的真机 34.9s / 66.6s **仅适用于 dev-verification build**。**productionSafe build 没有编译过、没有真机验证过**。生产 build 下预计会显著慢于该数字(完整 ZK rounds + 真 wire + 多参与方)。
- commit `8220e11` 的 deadline + 代际 + 看门狗 仅通过代码审计得出"恢复路径不影响正确性"的结论(详见 memory `mpc-aux-info-benchmark.md` "Recoverability boundary")。**未做真机 SW-kill 中途 → 看门狗触发 → 代际重启 端到端验证**。

## 3. Dev-trusted 逃生口

`_completeKeyShareFromDevTrustedAuxInfo`(`mpc-service.js:3542`)在 `_isDevVerificationEngine()` 返回 true 时会被触发,直接调 `devTrustedAuxInfoJson` 出"伪造" aux-info。**在当前 dev-verification build 下,只要 wire 端 `cggmp24:start-aux-info:after-create` 路径上的某处抛错,这条逃生口就会接管并完成 aux-info**。

**当前没有生产 build 阻断该路径**。在本文决策生效后,该路径的存活 = **dev-verification build 仍可被用于真实资金路径**,这违反 §1 决策正文 "未撤销 `_completeKeyShareFromDevTrustedAuxInfo`" 的诚实声明,且事实上等于"在 dev 逃生口未被关闭的前提下,把钱包放到了生产路径上"。

**因此本文同时撤销 dev-trusted 逃生口**,具体改动:

- 在 `_completeKeyShareFromDevTrustedAuxInfo` 入口加 gate:`if (!this._isProductionSafeEngine()) return null;`(镜像 `_isDevVerificationEngine` 的反向判断)。
- 同步在 `mpc-cggmp24-wasm-engine.js` 加 `getMetadata()?.productionSafe === true` 的判定。
- 该改动**仅在 productionSafe build 下放行 dev 逃生口**,dev-verification build 下逃生口失效 → 当前 build 在真机端到端验收未完成前**不可用于真实资金**(自然刹车)。

## 4. UI 提示同步

`feature-flags.js:47 ENABLE_EXPERIMENTAL_FEATURES: false` 默认关闭 MPC UI 入口。本文决策生效后:

- **不打开** 该开关(MPC UI 仍默认对终端用户隐藏)。
- **不修改** `wallet/docs/专项能力/多方计算钱包.md` 第 75 行 "MPC 入口必须明确标记为实验性"。
- 决策正文生效与 UI 入口开放**解耦**:UI 入口开放需在 §2 第 9 项准入条件(独立审计 + 高风险全关)全部满足后,由单独的架构决策处理。

## 5. 后续仍需做的(对应 `mpc-production-readiness.md` 必修门)

| 项 | 来源 | 当前状态 |
|---|---|---|
| P1 真机 2-party / 3-party 端到端验收 | §16.2 | 未做 |
| P2 完整 `npm test` 绿 | memory `mpc-npm-test-status.md` | keyring IPC flake + mpc-wallet-session-sync 长跑待修 |
| P3 安全审计 | §2 第 9 项 | 未做 |
| P4 持久化崩溃恢复真机验证 | §16.2 + memory "Recoverability boundary" | 推理完成,真机未做 |
| P5 UI 用户提示同步 | §4 | 本文决策生效后 UI 入口仍隐藏,无需改 |
| P6 文档同步 | §1 | 本文是 §6 文档同步的第一步 |
| P7 监控 / 告警 | §16.2 | 未做 |
| 编 productionSafe WASM build | §16.1 | 未做 |
| 撤销 `_completeKeyShareFromDevTrustedAuxInfo` dev 逃生口(加 productionSafe gate) | §3 | **本文决策生效时同时实施** |

## 6. 与现有 docs 的协调

- `wallet/docs/钱包架构/钱包架构决策.md` §7 (L187-201):状态从 "决策已完成。当前 MPC 明确保持实验性" 改为 "**实验性前置禁令取消,进入生产评审阶段;§2 9 项准入条件仍未全部满足**"。
- `wallet/docs/专项能力/多方计算钱包.md` §2 (L30-79):§2 第 38-42 行硬结论改为 "本文撤除 2026-08-08 决策的前置禁令,具体决策见 [`./MPC生产化评审决策.md`](./MPC生产化评审决策.md)";§2 第 75-77 行发布约束中"默认发布配置不得把实验性 MPC 作为推荐钱包类型" 在 UI 默认隐藏的前提下仍生效。
- `wallet/docs/专项能力/多方计算钱包.md` §16.1:保留全部要求,**追加 §2** 记录 dev-verification build 的当前状态与本文决策路径。
- `wallet/docs/专项能力/多方计算钱包.md` §16.2:保留 2026-08-25 快照全文,**追加 2026-09-11 补充观测**(即本文 §2)。
- 维护者:本文引用 `mpc-production-readiness.md`(同目录 `~/.claude/plans/`)作为完整 checklist。

## 7. 撤回路径

若后续审计或真机验收暴露重大问题,可由用户在本文 §6 引用路径上发新决策文档覆盖本文。任何撤回必须显式写明:

- 撤回的具体准入条件是哪几项仍未通过。
- 撤回后的硬约束是什么(默认回到 2026-08-08 实验性决策)。
- 撤回触发的工程动作(dev-trusted 逃生口是否同步恢复)。

不允许通过功能开关、免责声明或人工操作绕过任何一条硬约束。
