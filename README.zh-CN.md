# omp-cmux

[oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) 的 cmux 集成扩展，通过侧边栏状态和桌面通知持续呈现 agent 进度。

## 功能

- **侧边栏状态** — 实时显示模型、思考级别、token 用量、费用和当前工具
- **桌面通知** — 可配置的 agent 完成摘要通知，附带文件变更追踪

## 环境要求

- [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)
- [cmux](https://github.com/cmux/cmux) 终端复用器
- [Bun](https://bun.sh) ≥1.3（开发环境）

## 安装

```bash
# 克隆到 omp 扩展目录
git clone https://github.com/dlivxpr/omp-cmux.git ~/.omp/extensions/omp-cmux

# 安装依赖
cd ~/.omp/extensions/omp-cmux
bun install
```

该路径不会被原生自动发现；必须添加下面的 `extensions` 配置。若要使用原生自动发现，请放到 `~/.omp/agent/extensions/` 下。

然后在 omp 配置文件（`~/.omp/agent/config.yml`）中添加：

```yaml
extensions:
  - ~/.omp/extensions/omp-cmux
```

在 cmux 中启动时，扩展会自动检测当前 cmux 环境。仅当 cmux 通过自定义 socket 暴露时，才需要显式设置 `CMUX_SOCKET_PATH`。

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
