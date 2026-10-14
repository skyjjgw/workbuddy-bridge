# 第三方开源声明（Third-Party Notices）

> 本文档记录本项目在设计、实现上参考或复用的开源项目，以及各自的许可与合规要求。
> 通用构建依赖（`esbuild` 等）的许可证随各自 npm 包自动携带，不属于本文档范围。

## 一、核心模块来源（**代码复用**）

本项目**不重写** WorkBuddy 接入的核心逻辑，而是直接复用下列项目的模块，
收拢后打包为 `lib/core.mjs`。**未修改其源码。**

| 项目 | 仓库 | 复用内容 | 许可 |
| --- | --- | --- | --- |
| `dsh-connect-workbuddy` | <https://github.com/dingminhua/dsh-connect-workbuddy> | 下列 8 个模块：`shim.ts`（loopback OpenAI 兼容端点、SSE 直通、账号故障转移、DSML 恢复接线）、`upstream.ts`（WorkBuddy 上游协议与凭据刷新）、`auth.ts`（桌面端凭据发现与只读读取）、`catalog.ts`（模型目录）、`dsml-recovery.ts`（工具调用标记恢复）、`host-peers.ts`（宿主 peer 的本地兜底）、`at-rest.ts`（静态加密字段读取）、`status-paths.ts`（状态与路径解析） | **MIT**（Copyright (c) 2026 LaoDing） |

完整许可文本见 [LICENSE](LICENSE) —— 本项目在保留自身版权声明的同时，
一并保留了上述 MIT 许可与版权声明，符合 MIT 的要求。

## 二、间接来源

上游 `dsh-connect-workbuddy` 自身在其 `THIRD_PARTY_NOTICES.md` 中声明了对
以下项目的参考关系，本项目通过复用其模块而间接受益，一并致谢：

| 项目 | 仓库 | 关系 | 许可 |
| --- | --- | --- | --- |
| `dsh-workbuddy-connect` | <https://github.com/corrinehu/dsh-workbuddy-connect> | WorkBuddy 接入方案的参考实现 | MIT |
| `workbuddy2api` | <https://github.com/Sliverkiss/workbuddy2api> | 上游协议（`copilot.tencent.com` wire behavior）参考 | MIT |
| `workbuddy2api`（DSML 解析器） | <https://github.com/hawklithm/workbuddy2api> | 代码移植：`dsml_parser.py` 的标签状态机等 → `src/dsml-recovery.ts` | MIT（Copyright (c) 2026 Mayer） |
| `dsh-connect-trae` | <https://github.com/dingminhua/dsh-connect-trae> | 插件卡片结构与交互模型参考 | MIT |

## 三、本项目的原创部分

以下为本项目自行实现，不含上游代码：

- `src/server.mjs` —— 固定端口 + 固定 token 的桥接层，把核心 shim 暴露成
  天枢可直接接入的 OpenAI 兼容端点
- `scripts/setup.mjs` —— 调用天枢本地 API 完成服务商注册
- `scripts/doctor.mjs` —— 自检
- `scripts/build.mjs` —— 上游模块收拢与打包（含自包含性验收）
- `scripts/pack.mjs` / `run-bridge.cmd` / `start.cmd` —— 发布包与安装外壳

## 四、合规说明

- 本项目以 MIT 许可分发，**保留上游版权声明**，符合 MIT 的署名要求。
- 本项目**未修改**上游源码，仅做收拢与打包，因此不涉及对上游代码的
  衍生作品声明问题；但 `lib/core.mjs` 作为打包产物**包含**上游代码，
  故 LICENSE 中一并保留其声明。
- 若上游作者对复用方式有异议，请提 issue，本项目会配合调整。
