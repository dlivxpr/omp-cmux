# omp-cmux 功能扩展方案

> 基于对当前代码库、omp Extension API 和 cmux CLI 能力的完整调研，整理出尚未实现但具备实际价值的集成方向。

## 现状概览

### 已实现功能

| 模块 | 功能 |
|---|---|
| Slash 命令 | `/cmv`、`/cmh`（分屏开 pi）、`/cmo`、`/cmoh`（分屏跑命令）、`/cmz`、`/cmzh`、`/z`、`/zh`（zoxide 目录跳转）、`/cmcv`、`/cmch`（git worktree 分屏） |
| 侧边栏 | 6 个状态 key：`omp_state`、`omp_model`、`omp_thinking`、`omp_tokens`、`omp_cost`、`omp_tool` |
| 通知 | agent 完成摘要、长时间等待输入提醒、debounce 去重 |
| cmux 封装 | `cmux()` 保护性调用、`openCommandInNewSplit()` 生命周期管理、`shellEscape()` |
| Git | worktree 创建、分支校验、路径解析、上下文自动传递 |
| 配置 | 环境变量控制通知级别、阈值、debounce 窗口 |

### 未利用的 omp Extension API

- **事件**：`goal_updated`、`session_branch`/`session_switch`、`auto_compaction_start/end`、`auto_retry_start/end`、`message_start/update/end`、`tool_call`（支持拦截）、`tool_approval_*`、`user_bash`、`input`、`session_stop`、`context`、`before_provider_request`/`after_provider_response`、`ttsr_triggered`、`todo_reminder`、`credential_disabled`
- **API**：`registerTool()`、`registerShortcut()`、`registerFlag()`、`sendMessage()`、`sendUserMessage()`、`appendEntry()`、`setActiveTools()`、`setModel()`、`getSessionName()`/`setSessionName()`、`registerMessageRenderer()`、`events`（EventBus）
- **UI**：`ctx.ui.select()`/`confirm()`/`input()` 对话框、`setWidget()` 编辑器组件、`setHeader()`/`setFooter()`、`setTitle()` 窗口标题、`custom()` 自定义焦点组件、`setEditorText()`/`getEditorText()`/`pasteToEditor()`、`setWorkingMessage()`、`setStatus()`

### 未利用的 cmux CLI 能力

- `cmux diff` — 浏览器分屏查看 diff
- `set-progress` / `clear-progress` — 标签页进度条
- `log` / `list-log` / `clear-log` — 结构化日志
- `right-sidebar toggle/show/hide/focus/set/mode/files/find/vault/sessions/feed/dock` — 右侧边栏控制
- `cmux browser` 子命令集 — 浏览器控制
- `read-screen` / `capture-pane` — 屏幕读取
- `send` / `send-key` — 发送文本/按键到其他 pane
- `set-buffer` / `paste-buffer` — 缓冲区操作
- `resize-pane` / `swap-pane` / `join-pane` / `break-pane` — pane 操作
- `new-workspace` / `rename-workspace` / `select-workspace` / `close-workspace` — workspace 管理
- `cmux markdown open <path>` — Markdown 查看器
- `tab-action` / `rename-tab` / `move-tab-to-new-workspace` — 标签页管理
- `surface resume set/show/get/clear` — surface 恢复
- `identify` / `trigger-flash` — 窗口标识
- `cmux events` — SSE 事件订阅
- `cmux rpc <method>` — 原始 RPC 调用

---

## 第一梯队：高价值、低复杂度

### 1. 标签页进度条

**利用**：`cmux set-progress` / `clear-progress` × omp 生命周期事件

当前侧边栏只显示文本状态，缺少视觉进度反馈。cmux 支持在标签页上显示进度条，可以和 agent 生命周期绑定：

- `agent_start` → `set-progress`（indeterminate 模式）
- `tool_result` → 更新进度条标签为当前工具名
- `agent_end` → `clear-progress`
- `auto_compaction_start` → 显示 "Compacting…"
- `auto_retry_start` → 显示 "Retrying…"

**价值**：多窗格布局中，一眼就能看出哪个 pane 的 agent 还在工作。比侧边栏文字更直觉。

**预估复杂度**：低。新建 `progress.ts` 模块，在 `index.ts` 中注册事件，调用 `cmux()` 封装即可。约 50-80 行代码。

### 2. Diff 查看命令

**利用**：`cmux diff` × 新 slash command

cmux 有内置的浏览器 diff 查看器，目前完全没用到。

- 新增 `/cmd [file]` 命令 — 在浏览器分屏中打开当前 git diff（或指定文件的 diff）
- 可选：在 `agent_end` 通知中，如果有文件变更，附加 "查看 diff" 的提示

**价值**：agent 改完代码后，不用手动切终端执行 `git diff`，一条命令在旁边窗格渲染好 diff。

**预估复杂度**：低。在 `commands.ts` 中新增一个 slash command，核心逻辑是一次 `cmux diff` 调用。约 30-50 行代码。

### 3. Session 名称 → 标签页标题同步

**利用**：`getSessionName()` / `setSessionName()` × `cmux rename-tab`

omp 有 session 命名 API，cmux 有标签页重命名。可以在 session 启动或切换时自动同步：

- `agent_start` 或 `session_switch` 事件 → 读取 `getSessionName()` → `cmux rename-tab` 设为标签页名
- 多 session 并行时，每个标签页名就是 session 名称，不再混淆

**价值**：多 session 场景下最自然的区分方式。实现极简。

**预估复杂度**：极低。约 15-30 行代码。

---

## 第二梯队：中等价值、中等复杂度

### 4. 结构化日志面板

**利用**：`cmux log` / `list-log` / `clear-log` × omp 事件流

把 omp 的关键事件写入 cmux 的结构化日志系统：

- `tool_call` 事件 → 记录工具名、参数摘要、耗时
- `tool_result` 中含 error → 标记为 error 级别
- `session_branch` / `session_switch` → 记录分支操作
- `goal_updated` → 记录目标变更

**价值**：持久化的 agent 活动时间线。比通知更详细，比聊天记录更结构化。事后可回溯 "agent 都做了什么"。

**预估复杂度**：中等。需要设计日志格式、控制写入频率避免刷屏。约 80-120 行代码。

### 5. Markdown 预览命令

**利用**：`cmux markdown open <path>` × 新 slash command

- 新增 `/cmmd <path>` 命令 — 在分屏中打开 Markdown 预览（带实时刷新）
- 可选：结合 `todo_reminder` 事件，agent 更新 plan 文件时自动在旁边打开预览

**价值**：写文档、看 plan、review AGENTS.md 时不离开终端。

**预估复杂度**：低到中等。核心是一条 `cmux markdown open` 调用，但路径解析和补全需要处理。约 40-70 行代码。

### 6. 右侧边栏文件浏览集成

**利用**：`cmux right-sidebar files/find` × omp 事件

- 新增 `/cmf [query]` 命令 — 打开右侧边栏的 find 模式并聚焦
- 可选：`tool_result` 中检测到文件读写操作时 → 自动在右侧边栏高亮对应文件路径

**价值**：让用户实时跟踪 agent 正在操作哪些文件。

**预估复杂度**：中等。需要解析 tool_result 中的文件路径，处理右侧边栏状态切换。约 60-100 行代码。

---

## 第三梯队：高价值、高复杂度

### 7. 跨窗格屏幕读取工具

**利用**：`cmux read-screen` / `capture-pane` × `registerTool()`

通过 `registerTool()` 注册一个全新的 agent 工具，让 agent 能读取其他 pane 的屏幕内容：

```
工具名: read_pane
参数: { pane_id?: string }
返回: 目标 pane 的当前屏幕文本
```

底层调用 `cmux read-screen` 或 `capture-pane` 实现。

**价值**：全新能力——agent 可以感知其他终端窗格正在发生什么。典型场景：一个 pane 跑着 dev server 报错，agent 读取错误信息并自动修复。

**预估复杂度**：高。需要处理 pane 发现（列出可用 pane）、内容截取、输出清洗。还需考虑安全性（agent 是否应该随意读取任意 pane）。约 120-180 行代码。

### 8. 跨窗格命令发送工具

**利用**：`cmux send` / `send-key` × `registerTool()`

注册工具让 agent 向其他 pane 发送命令：

```
工具名: send_to_pane
参数: { pane_id: string, text: string, confirm?: boolean }
返回: { ok: boolean }
```

**价值**：配合 `read_pane`，agent 可以形成"多终端协作"工作流——在一个 pane 写代码，在另一个 pane 运行测试。

**预估复杂度**：高。安全性是核心问题——必须要求用户确认，可结合 `tool_approval` 事件或 `ctx.ui.confirm()` 实现。约 100-150 行代码。

### 9. 工具调用拦截 + 审批增强

**利用**：`tool_call` 拦截 × cmux 通知 / UI

omp 的 `tool_call` 事件支持拦截（可修改或取消工具调用）。结合 cmux 的通知系统：

- 对高风险操作（`bash` 中的 `rm -rf`、`git push --force` 等）→ 通过 cmux 发送通知要求确认
- 在侧边栏显示 "⏸ 等待审批" 状态
- 非焦点窗格中运行的 agent 也能得到安全保障

**价值**：为后台运行的 agent 提供安全网。

**预估复杂度**：高。需要实现异步确认流——拦截工具调用 → 发通知 → 等待用户响应 → 恢复或取消。约 150-200 行代码。

### 10. Workspace 一键编排

**利用**：`cmux new-workspace` × 复合命令

新增高级命令，一次性创建完整的工作环境：

- `/cmws <name>` — 创建新 workspace，自动开 2-3 个 pane（editor、terminal、server），各自运行预设命令
- 支持通过配置文件定义 workspace 模板

**价值**：项目启动的"一键环境"。

**预估复杂度**：高。需要设计配置格式、处理多 pane 编排的时序问题。约 150-250 行代码。

---

## 不建议的方向

| 方向 | 原因 |
|---|---|
| cmux 主题切换集成 | 纯装饰性功能，和 agent 工作流无关 |
| cmux SSH 集成 | cmux SSH 本身已可用，agent 无需介入 |
| cmux 浏览器自动化 | cmux browser 子命令体系较重，omp 已有独立的 browser 工具 |
| `before_provider_request` 拦截 | 除非做 token 统计或请求缓存，否则容易引入不可预期的副作用 |
| `surface resume` 集成 | 场景过窄，只在 cmux 重启恢复时有用，omp 侧无对应需求 |

---

## 推荐实施顺序

优先做第一梯队的 3 个功能，投入产出比最高：

1. **Session 名称同步**（~15-30 行，立即可用）
2. **标签页进度条**（~50-80 行，视觉效果明显）
3. **Diff 查看命令**（~30-50 行，填补常见工作流断点）

之后按需推进第二梯队。第三梯队中的"跨窗格屏幕读取"最值得投入，因为它为 agent 带来了全新的感知能力。
