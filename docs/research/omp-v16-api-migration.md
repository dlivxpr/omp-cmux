# omp-cmux：oh-my-pi v16 API 迁移调研

> 调研日期：2026-07-12；范围为官方 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) 的 `v16.0.0` 至最新 release/tag `v16.4.6`。审计范围严格为本项目 `package.json`、`types/oh-my-pi-stub.d.ts`（不存在）和 `extensions/cmux/**/*.ts`。本文不改项目源码，所有 API 结论只采用官方 release、源码或 docs。

## 范围与方法

1. 已读取官方 [docs 入口](https://github.com/can1357/oh-my-pi/tree/main/docs) 及 [Authoring Extensions](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md)。后者规定 extension 使用 `ExtensionAPI` 工厂注册 handler，npm/link plugin 的 manifest 使用 `package.json#omp.extensions`。
2. 以官方 [releases feed](https://github.com/can1357/oh-my-pi/releases) 和 [Tags](https://github.com/can1357/oh-my-pi/tags) 定位 v16 全部 tag，核对 release note；对 Breaking Changes 再比较 `v16.0.0` 与 current main 的真实类型/源码。
3. 当前官方源码包版本是 [`16.4.6`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/package.json#L1-L6)；当前项目 `package.json` 声明 `@oh-my-pi/pi-coding-agent: ^16.4.0`，安装版本为 `16.4.0`。只将本项目真实调用且已被上游移除/重命名的 API 列为“必须修改”。

## 版本 / release 覆盖清单

| 系列 | 已逐个核查的 release/tag | 与本项目相关的 release-note 结论 |
|---|---|---|
| `v16.0` | [`v16.0.0`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.0), [`v16.0.1`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.1), [`v16.0.2`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.2), [`v16.0.3`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.3), [`v16.0.4`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.4), [`v16.0.5`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.5), [`v16.0.6`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.6), [`v16.0.7`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.7), [`v16.0.8`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.8), [`v16.0.9`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.9), [`v16.0.10`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.10), [`v16.0.11`](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.11) | `v16.0.0` 有 dialect/grammar 破坏变更；无项目调用命中。 |
| `v16.1` | [`v16.1.0`](https://github.com/can1357/oh-my-pi/releases/tag/v16.1.0) 至 [`v16.1.23`](https://github.com/can1357/oh-my-pi/releases/tag/v16.1.23)（包含每个 patch tag） | `repeatToolDescriptions` 改为 `inlineToolDescriptors`；本项目未读取。 |
| `v16.2` | [`v16.2.0`](https://github.com/can1357/oh-my-pi/releases/tag/v16.2.0) 至 [`v16.2.13`](https://github.com/can1357/oh-my-pi/releases/tag/v16.2.13)（包含每个 patch tag） | **`v16.2.0` 将 `search/find` 改为 `grep/glob`，直接命中。** |
| `v16.3` | [`v16.3.0`](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.0) 至 [`v16.3.15`](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.15)（包含每个 patch tag） | `requiresJuiceZeroHack` 改名；本项目未使用。 |
| `v16.4` | [`v16.4.0`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.0), [`v16.4.1`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.1), [`v16.4.2`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.2), [`v16.4.3`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.3), [`v16.4.4`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.4), [`v16.4.5`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.5), [`v16.4.6`](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.6) | `v16.4.0` 的 `explore`→`scout`、DAP、reasoning ladder 破坏变更均未命中。 |

> 对表中 `v16.1.1`…`v16.1.22`、`v16.2.1`…`v16.2.12`、`v16.3.1`…`v16.3.14`，官方 URL 均为 `https://github.com/can1357/oh-my-pi/releases/tag/<tag>`；tag 存在性由上列官方 Tags 页面复核。`v16.4.6` 是本次调研终点。

## 破坏性变化表（release note 以源码核验）

| 首次版本 | 旧 API | 当前 API | 影响文件/符号 | 证据与建议 |
|---|---|---|---|---|
| `v16.0.0` | `ToolCallFormat`、`resolveToolCallSyntax`、`toolCallSyntax` | `DialectFormat`、`resolveDialect`、`dialect` | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.0) 明列变更。**已兼容，无需修改**：项目未导入。 |
| `v16.0.0` | `@oh-my-pi/pi-ai/grammar`、`ToolCallSyntax`、`Grammar` | `@oh-my-pi/pi-ai/dialect`、`Dialect`、`DialectDefinition` | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.0.0)。**已兼容，无需修改**。 |
| `v16.1.0` | `repeatToolDescriptions` | `inlineToolDescriptors`（`v16.2.0` 改为 `auto | on | off`） | 无 | [v16.1.0](https://github.com/can1357/oh-my-pi/releases/tag/v16.1.0)、[v16.2.0](https://github.com/can1357/oh-my-pi/releases/tag/v16.2.0)。**已兼容，无需修改**。 |
| `v16.2.0` | 内建工具/事件名 `search`、`find` | `grep`、`glob` | `extensions/cmux/notify.ts#isSearchToolResult` | [release 明确标为 Breaking Changes](https://github.com/can1357/oh-my-pi/releases/tag/v16.2.0)；current [`ToolResultEvent`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L815-L851) 只含 `GrepToolResultEvent` / `GlobToolResultEvent`。**已确认需修改**为 `grep || glob`。 |
| `v16.3.0` | `requiresJuiceZeroHack`；`"juice-zero-developer-message"` | `requiresReasoningSuppressionPrompt`；后者 union 成员移除 | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.0)。**已兼容，无需修改**：无 catalog/OpenAI compatibility 调用。 |
| `v16.4.0` | bundled agent/config/task 的 `explore` | `scout` | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.0)。**已兼容，无需修改**：项目不注册 agent/task。 |
| `v16.4.0` | `selectLaunchAdapter(): DapResolvedAdapter | null` | `LaunchAdapterSelection` | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.0)。**已兼容，无需修改**：无 DAP 调用。 |
| `v16.4.0` | shifted reasoning effort maps | upstream 原生逐档，`clampThinkingLevelForModel` | 无 | [官方 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.4.0)。**已兼容，无需修改**：仅调用仍存在的 `pi.getThinkingLevel()`。 |

### release note 与源码不一致

`v16.2.0` 的 Added 段仍以自然语言称 SSH 支持 `read`、`search`、`write`，但同页 Breaking Changes 已宣布 `search`→`grep`、`find`→`glob`。不能据此保留旧名：官方 current 类型实际已删除 `SearchToolResultEvent` / `FindToolResultEvent`，只定义 `GrepToolResultEvent` / `GlobToolResultEvent`（[源码](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L815-L851)）。因此以类型/实现为准；Added prose 是未同步的旧术语，不推断旧事件仍会发送。

## 项目逐文件审计

| 文件/符号 | 当前调用 | 分类、证据与建议 |
|---|---|---|
| `package.json` | `omp.extensions: ["./extensions/cmux/index.ts"]`；`^16.4.0` | **已兼容，无需修改**。官方文档确认 `omp.extensions` 是 npm/link extension manifest：[文档](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md#packagejson-manifest)。 |
| `types/oh-my-pi-stub.d.ts` | 不存在；未找到任何同名 stub | **已兼容，无需修改**。不应新增自造声明，使用安装包真实类型。 |
| `extensions/cmux/index.ts#cmuxExtension` | `pi.setLabel("cmux")`、注册 handlers | **已兼容，无需修改**。当前 [`ExtensionAPI.setLabel`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L1120-L1125) 仍存在。 |
| `extensions/cmux/sidebar.ts#registerSidebarHandlers` | `pi.on`（session/agent/turn/tool execution）、`ctx.hasUI`、`ctx.getContextUsage()`、`pi.getThinkingLevel()` | **已兼容，无需修改**。当前 event overload 与 `getThinkingLevel()` 仍存在：[类型](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L1040-L1200)。`ContextUsage.tokens` 已收紧为 `number`，[现有 `undefined` 防御判断](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L341-L347) 仍安全。 |
| `extensions/cmux/cmux.ts#readTmuxEnvironment/#executeCmux/#cmuxNotify` | `pi.exec(command,args,{timeout})`，读取 `ExecResult` | **已兼容，无需修改**。当前签名仍为 [`exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L1190-L1194)。 |
| `extensions/cmux/notify.ts#isSearchToolResult` | `event.toolName === "search" || event.toolName === "find"` | **已确认需修改**。16.4.x 实际只发 `grep/glob`；否则通知摘要漏计搜索。改为 `event.toolName === "grep" || event.toolName === "glob"`，并同步测试。 |
| `extensions/cmux/notify.ts#getAgentEndStatus` | `isSilentAbort(assistant)` | **已兼容，无需修改；待运行时确认**。本范围 release notes 未宣布移除，安装 `16.4.0` 可用；升级后应验证 plan-ready 分支。 |
| `extensions/cmux/*.test.ts` | test double / `ToolResultEvent` fixture | **随必须修改项同步**。以 `grep/glob` 覆盖摘要计数，并断言旧名不再算内建搜索工具。 |

## 必须修改清单

1. `extensions/cmux/notify.ts#isSearchToolResult`：把 `"search" || "find"` 改为 `"grep" || "glob"`。这是已确认的 API 迁移，不是兼容 shim；证据为 [v16.2.0 release](https://github.com/can1357/oh-my-pi/releases/tag/v16.2.0) 与 [当前联合类型](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts#L815-L851)。
2. `extensions/cmux/notify.test.ts`：把该分支的工具结果 fixture/断言一起改为 `grep/glob`，测试应保护可观察的通知摘要计数。

## 无需修改清单

- `package.json#omp.extensions`，`ExtensionAPI` factory，`pi.setLabel`，`pi.on`，`pi.exec`，`pi.getThinkingLevel`：均在 current official API 中存在。
- sidebar 的 `hasUI` / `model` / `getContextUsage` 用法：未被本次破坏变更影响。
- v16.0 dialect/grammar、v16.3 catalog compatibility、v16.4 scout/DAP/reasoning map：项目均无调用点。

## 待运行时确认与验证建议

1. 以 `@oh-my-pi/pi-coding-agent@16.4.6` 运行一次 `grep`、一次 `glob`，确认 `tool_result` 到达 extension 且通知摘要计数各为 1。
2. 在实际 cmux session（存在 `CMUX_WORKSPACE_ID` 或 tab/surface/panel target）确认 `pi.exec()` 的 `cmux notify`/`set-status` 调用成功；这是本项目环境转发验证，非已证实的 oh-my-pi API 破坏。
3. 构造 silent-abort/plan-ready，会验证 `isSilentAbort` 分支只给 `Plan Ready`，不发送 `Waiting`。
4. 实现迁移后，先运行受影响的 `extensions/cmux/notify.test.ts` 与 `bun run typecheck`，随后做上述 runtime smoke test。本轮已对当前锁定的 `16.4.0` 执行 `bun run typecheck`（通过），并用 `bun outdated` 确认 registry 最新版为 `16.4.6`；尚未升级依赖或执行项目测试。官方文档也要求 extension factory 只注册能力、runtime action 放在 handler 中，并将加载诊断写到 `~/.omp/logs/`：[官方文档](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md#debugging)。

## 完整覆盖 tag 枚举

为避免“至”隐藏具体范围，本次逐个核查的 v16 tags 是：

- `v16.0.0`, `v16.0.1`, `v16.0.2`, `v16.0.3`, `v16.0.4`, `v16.0.5`, `v16.0.6`, `v16.0.7`, `v16.0.8`, `v16.0.9`, `v16.0.10`, `v16.0.11`。
- `v16.1.0`, `v16.1.1`, `v16.1.2`, `v16.1.3`, `v16.1.4`, `v16.1.5`, `v16.1.6`, `v16.1.7`, `v16.1.8`, `v16.1.9`, `v16.1.10`, `v16.1.11`, `v16.1.12`, `v16.1.13`, `v16.1.14`, `v16.1.15`, `v16.1.16`, `v16.1.17`, `v16.1.18`, `v16.1.19`, `v16.1.20`, `v16.1.21`, `v16.1.22`, `v16.1.23`。
- `v16.2.0`, `v16.2.1`, `v16.2.2`, `v16.2.3`, `v16.2.4`, `v16.2.5`, `v16.2.6`, `v16.2.7`, `v16.2.8`, `v16.2.9`, `v16.2.10`, `v16.2.11`, `v16.2.12`, `v16.2.13`。
- `v16.3.0`, `v16.3.1`, `v16.3.2`, `v16.3.3`, `v16.3.4`, `v16.3.5`, `v16.3.6`, `v16.3.7`, `v16.3.8`, `v16.3.9`, `v16.3.10`, `v16.3.11`, `v16.3.12`, `v16.3.13`, `v16.3.14`, `v16.3.15`。
- `v16.4.0`, `v16.4.1`, `v16.4.2`, `v16.4.3`, `v16.4.4`, `v16.4.5`, `v16.4.6`。

每一个 tag 的官方 release URL 都可由 [releases 页面](https://github.com/can1357/oh-my-pi/releases) 或 `https://github.com/can1357/oh-my-pi/releases/tag/<tag>` 访问；上述四个系列表已经为各系列的首尾及所有在本项目命中的关键 release 提供直接链接。
