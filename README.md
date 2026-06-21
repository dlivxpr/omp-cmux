# omp-cmux

cmux integration extension for [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi) — sidebar status, desktop notifications, zoxide-powered directory jumping, git worktree orchestration, and split-pane session management, all from within omp slash commands.

## Features

- **Split-pane sessions** — open new omp sessions or shell commands in right/bottom splits
- **Sidebar status** — real-time model, thinking level, token usage, cost, and current tool display
- **Desktop notifications** — configurable summaries on agent completion with tracked file changes
- **Zoxide integration** — jump to frequently-visited directories via `/z` and `/zh`
- **Git worktree support** — create worktree branches and open them in splits with context

## Requirements

- [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)
- [cmux](https://github.com/cmux/cmux) terminal multiplexer
- [Bun](https://bun.sh) ≥1.3 (for development)
- [zoxide](https://github.com/ajeetdsouza/zoxide) (optional, for `/z` / `/zh` commands)
- [git](https://git-scm.com) (optional, for worktree commands)

## Installation

```bash
# Clone into your omp extensions directory
git clone https://github.com/dlivxpr/omp-cmux.git ~/.omp/extensions/omp-cmux

# Install dependencies
cd ~/.omp/extensions/omp-cmux
bun install
```

This path is not auto-discovered; the config stanza below is required. For native auto-discovery, place the package under `~/.omp/agent/extensions/` instead.

Then add to your omp config (`~/.omp/agent/config.yml`):

```yaml
extensions:
  - ~/.omp/extensions/omp-cmux
```

Ensure `CMUX_SOCKET_PATH` is set in your environment (cmux does this automatically when running inside a cmux session).

## Commands

| Command | Description |
|---|---|
| `/cmv [prompt]` | Open new pi session in right split |
| `/cmh [prompt]` | Open new pi session in bottom split |
| `/cmo <command>` | Run shell command in right split |
| `/cmoh <command>` | Run shell command in bottom split |
| `/cmz <query>` | Open pi in zoxide-matched directory (right split) |
| `/cmzh <query>` | Open pi in zoxide-matched directory (bottom split) |
| `/z <query>` | Alias for `/cmz` |
| `/zh <query>` | Alias for `/cmzh` |
| `/cmcv -c <branch> [--from <ref>] [note]` | Create git worktree and open in right split |
| `/cmch -c <branch> [--from <ref>] [note]` | Create git worktree and open in bottom split |

Commands gracefully fail with a notification when cmux is not available.

## Configuration

All settings via environment variables:

| Variable | Values | Default | Description |
|---|---|---|---|
| `OMP_CMUX_NOTIFY_LEVEL` | `all`, `medium`, `low`, `disabled` | `medium` | Notification verbosity |
| `PI_CMUX_NOTIFY_THRESHOLD_MS` | milliseconds | `15000` | Minimum run duration before the optional "Ready for input" notification |
| `PI_CMUX_NOTIFY_DEBOUNCE_MS` | milliseconds | `3000` | Minimum interval between duplicate notifications |

### Notification Levels

- **`all`** — every notification (waiting, complete, error)
- **`medium`** — complete and error notifications only
- **`low`** — error notifications only
- **`disabled`** — no notifications

## Sidebar Status

When running inside cmux, the extension displays these status entries:

- **omp_state** — Idle / Working
- **omp_model** — current model (e.g. `sonnet-4`)
- **omp_thinking** — thinking level (e.g. `low`, `high`, `off`)
- **omp_tokens** — context window usage
- **omp_cost** — cumulative session cost
- **omp_tool** — currently executing tool

## Development

```bash
bun install          # install dependencies
bun run typecheck    # run TypeScript type checking
```

The extension is loaded as raw TypeScript by the omp harness — no build step required.

## License

[MIT](LICENSE)
