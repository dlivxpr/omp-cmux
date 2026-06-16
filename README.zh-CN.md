# omp-cmux

[oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) 的 cmux 集成扩展 — 提供侧边栏状态、桌面通知、基于 zoxide 的目录跳转、git worktree 编排以及分屏会话管理，全部通过 omp 斜杠命令操作。

## 功能

- **分屏会话** — 在右侧/底部分屏中打开新的 omp 会话或 shell 命令
- **侧边栏状态** — 实时显示模型、思考级别、token 用量、费用和当前工具
- **桌面通知** — 可配置的 agent 完成摘要通知，附带文件变更追踪
- **Zoxide 集成** — 通过 `/z` 和 `/zh` 快速跳转到常用目录
- **Git worktree 支持** — 创建 worktree 分支并在分屏中打开，附带上下文信息

## 环境要求

- [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)
- [cmux](https://github.com/cmux/cmux) 终端复用器
- [Bun](https://bun.sh) ≥1.3（开发环境）
- [zoxide](https://github.com/ajeetdsouza/zoxide)（可选，用于 `/z` / `/zh` 命令）
- [git](https://git-scm.com)（可选，用于 worktree 命令）

## 安装

```bash
# 克隆到 omp 扩展目录
git clone https://github.com/dlivxpr/omp-cmux.git ~/.omp/extensions/omp-cmux

# 安装依赖
cd ~/.omp/extensions/omp-cmux
bun install
```

然后在 omp 配置文件（`~/.omp/agent/config.yml`）中添加：

```yaml
extensions:
  - ~/.omp/extensions/omp-cmux
```

请确保环境中已设置 `CMUX_SOCKET_PATH`（在 cmux 会话中运行时 cmux 会自动设置）。

## 命令

| 命令 | 说明 |
|---|---|
| `/cmv [prompt]` | 在右侧分屏打开新的 pi 会话 |
| `/cmh [prompt]` | 在底部分屏打开新的 pi 会话 |
| `/cmo <command>` | 在右侧分屏运行 shell 命令 |
| `/cmoh <command>` | 在底部分屏运行 shell 命令 |
| `/cmz <query>` | 在 zoxide 匹配的目录中打开 pi（右侧分屏） |
| `/cmzh <query>` | 在 zoxide 匹配的目录中打开 pi（底部分屏） |
| `/z <query>` | `/cmz` 的别名 |
| `/zh <query>` | `/cmzh` 的别名 |
| `/cmcv -c <branch> [--from <ref>] [note]` | 创建 git worktree 并在右侧分屏打开 |
| `/cmch -c <branch> [--from <ref>] [note]` | 创建 git worktree 并在底部分屏打开 |

当 cmux 不可用时，命令会优雅降级并显示通知。

## 配置

所有设置通过环境变量配置：

| 变量 | 可选值 | 默认值 | 说明 |
|---|---|---|---|
| `OMP_CMUX_NOTIFY_LEVEL` | `all`, `medium`, `low`, `disabled` | `medium` | 通知详细程度 |
| `PI_CMUX_NOTIFY_THRESHOLD_MS` | 毫秒数 | `15000` | "等待输入"通知的延迟时间 |
| `PI_CMUX_NOTIFY_DEBOUNCE_MS` | 毫秒数 | `3000` | 重复通知的最小间隔 |

### 通知级别

- **`all`** — 所有通知（等待、完成、错误）
- **`medium`** — 仅完成和错误通知
- **`low`** — 仅错误通知
- **`disabled`** — 不发送通知

## 侧边栏状态

在 cmux 中运行时，扩展会显示以下状态条目：

- **omp_state** — 空闲 / 工作中
- **omp_model** — 当前模型（如 `sonnet-4`）
- **omp_thinking** — 思考级别（如 `low`、`high`、`off`）
- **omp_tokens** — 上下文窗口用量
- **omp_cost** — 会话累计费用
- **omp_tool** — 当前正在执行的工具

## 开发

```bash
bun install          # 安装依赖
bun run typecheck    # 运行 TypeScript 类型检查
```

扩展由 omp 运行时直接加载原始 TypeScript 源文件，无需构建步骤。

## 许可证

[MIT](LICENSE)
