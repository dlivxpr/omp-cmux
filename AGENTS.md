# Repository Guidelines

## Project Overview

`omp-cmux` is an **oh-my-pi extension** that bridges the omp AI coding agent with **cmux** (a terminal multiplexer). It provides split-pane session management, desktop notifications, sidebar status display, zoxide-based directory jumping, and git worktree orchestration — all controlled from within omp slash commands.

## Architecture & Data Flow

```
index.ts (entry: ExtensionFactory)
 ├─ commands.ts  ──> cmux.ts (split orchestration)
 │                ──> zoxide.ts (directory resolution)
 │                ──> worktree.ts ──> git-core.ts (worktree creation)
 │                
 ├─ [cmux available?]
 │   ├─ notify.ts  ──> cmux.ts (fire-and-forget notify CLI)
 │   │              ──> config.ts (env-based gating)
 │   └─ sidebar.ts ──> cmux.ts (status display commands)
 │
 └─ [cmux unavailable] → only commands registered (graceful no-op)
```

- **Entry point**: `extensions/cmux/index.ts` exports a single `ExtensionFactory` function.
- **Feature gating**: `isCmuxAvailable()` checks `!!process.env.CMUX_SOCKET_PATH`. All cmux-dependent features check this before attempting CLI calls.
- **Event-driven**: Notify and sidebar modules register handlers on omp lifecycle events (`agent_start`, `agent_end`, `tool_result`, `turn_end`, `session_shutdown`, etc.).
- **Fire-and-forget**: cmux CLI calls for UI features (notify, sidebar) never block or throw — failures are silently swallowed.
- **Result pattern**: Async operations return discriminated unions: `{ ok: true; ... } | { ok: false; error: string }`.

## Key Directories

| Path | Purpose |
|---|---|
| `extensions/cmux/` | All extension source modules |
| `types/` | TypeScript declaration stubs for oh-my-pi API |
| `extensions/cmux/index.ts` | Extension entry point / factory |
| `extensions/cmux/cmux.ts` | cmux CLI integration, split lifecycle |
| `extensions/cmux/commands.ts` | Slash command registration |
| `extensions/cmux/notify.ts` | Desktop notification tracking & dispatch |
| `extensions/cmux/sidebar.ts` | Sidebar status bar management |
| `extensions/cmux/config.ts` | Environment-based configuration |
| `extensions/cmux/zoxide.ts` | zoxide directory matching & resolution |
| `extensions/cmux/worktree.ts` | Git worktree split orchestration |
| `extensions/cmux/git-core.ts` | Git CLI wrappers |

## Development Commands

```bash
# Type-check only (no build, no tests)
bun run typecheck    # tsc --noEmit

# Install dependencies
bun install          # uses bun@1.3.14, declared in package.json#packageManager
```

- **Package manager**: `bun` only. Never use npm, yarn, or pnpm.
- **No build step**: The extension is loaded as raw TypeScript by the omp harness at runtime.
- **No test suite** defined in scripts.

## Code Conventions & Common Patterns

### Module Structure

- **Decoupled modules** — each `.ts` file is a self-contained concern. Never consolidate into a single file.
- **Imports are always absolute** within the extension scope, using `"@oh-my-pi/pi-coding-agent"` for the harness API.
- No barrel files, no re-exports beyond what each module naturally exports.

### Error Handling

- **UI features must never break the main flow**. Use safe wrappers (`safeSendNotification`, `safeSetSidebarState`, `safeClearSidebar`) that wrap calls in try/catch.
- **Command handlers** notify the user on failure via `ctx.ui.notify(result.error, "error")`.
- **cmux calls** are `try/catch` guarded and return `undefined` on failure — callers check truthiness.

### Result Types

Use discriminated unions for operations that can fail:
```typescript
{ ok: true; path: string } | { ok: false; error: string }
{ ok: true; info: CallerInfo } | { ok: false; error: string }
```

### Environment-Based Configuration

All config reads from `process.env` with sensible defaults:
- `CMUX_SOCKET_PATH` — feature gate (cmux available iff set)
- `OMP_CMUX_NOTIFY_LEVEL` — `"all" | "medium" | "low" | "disabled"` (default `"medium"`)
- `PI_CMUX_NOTIFY_THRESHOLD_MS` — duration before "Waiting for input" notification (default 15000)
- `PI_CMUX_NOTIFY_DEBOUNCE_MS` — debounce window for duplicate notifications (default 3000)

### Shell Escaping

`shellEscape(str)` wraps a string in single quotes, escaping internal `'` as `'\''`. Used when building shell commands passed to cmux respawn.

### Timing Constants (cmux.ts)

| Constant | Value | Purpose |
|---|---|---|
| `CMUX_TIMEOUT_MS` | 5000 | cmux CLI call timeout |
| `SPLIT_READY_ATTEMPTS` | 20 | Polling attempts for new surface |
| `SPLIT_READY_DELAY_MS` | 150 | Delay between polling attempts |
| `SURFACE_BOOT_DELAY_MS` | 250 | Wait after surface creation before respawn |

### Notification Tracker Pattern

`NotifyTracker` wraps a `RunState` object (read files, changed files, search/bash counts, errors) with a `reset()` method. Created once in `index.ts`, shared across event handlers. Tracks tool usage per agent run and generates a summary notification on `agent_end`.

### Sidebar Status Pattern

Status keys are declared as a const array (`STATUS_KEYS`) with a derived union type (`StatusKey`). Status updates are always fire-and-forget via the `run()` helper (cmux call with `.catch(() => {})`).

## Important Files

| File | Role |
|---|---|
| `package.json` | Declares `omp.extensions` entry point, devDependencies, scripts |
| `tsconfig.json` | Strict TypeScript, ES2022 target, ESNext modules, `bundler` resolution |
| `types/oh-my-pi-stub.d.ts` | Compile-time type stubs for the oh-my-pi `ExtensionAPI` |
| `extensions/cmux/index.ts` | Extension factory — wires modules together |
| `extensions/cmux/cmux.ts` | cmux CLI interface and split orchestration |

## Runtime/Tooling Preferences

- **Runtime**: Bun 1.3.14 (declared via `packageManager` in `package.json`)
- **TypeScript**: 6.0.3, strict mode, `bundler` module resolution, no emit
- **Features used**: top-level `await` not needed — all async work is in event handlers
- **Node APIs used**: `node:fs/promises` (`stat`), `node:path` (`resolve`, `dirname`, `basename`)

## Testing & QA

- **No formal test suite** configured. The `typecheck` script (`tsc --noEmit`) is the only automated check.
- Type safety is enforced via `strict: true` in tsconfig and the typed stub layer in `types/oh-my-pi-stub.d.ts`.

## Slash Commands

| Command | Description |
|---|---|
| `/cmv` | Open new pi session in right split |
| `/cmh` | Open new pi session in bottom split |
| `/cmo <cmd>` | Run shell command in right split |
| `/cmoh <cmd>` | Run shell command in bottom split |
| `/cmz <query>` | Open pi in zoxide-matched directory (right) |
| `/cmzh <query>` | Open pi in zoxide-matched directory (bottom) |
| `/z <query>` | Alias for `/cmz` |
| `/zh <query>` | Alias for `/cmzh` |
| `/cmcv -c <branch> [--from <ref>] [note]` | Git worktree in right split |
| `/cmch -c <branch> [--from <ref>] [note]` | Git worktree in bottom split |

Commands gracefully no-op when cmux is unavailable — `cmux()` and `openCommandInNewSplit()` return error results that the handler converts to user-facing notifications.

## Key Design Decisions

1. **Fire-and-forget UI calls** — sidebar and notify cmux invocations use `.catch(() => {})`; they must never block or throw into the extension harness.
2. **Feature gate at every call site** — `isCmuxAvailable()` is checked in `cmux()` and `getCallerInfo()`, not just at registration time. This allows commands to be always registered (for discoverability) while gracefully failing when cmux is absent.
3. **Summary generation mirrors upstream notification format** — `generateSummary()` produces title/subtitle/body tuples that align with omp's native notification contracts.
4. **Worktree path convention** — worktrees go to `../<repo>-worktrees/<slugified-branch>/`, created via `git worktree add -b <branch>`.
5. **Dynamic imports for Node path/fs modules** — `git-core.ts` uses `await import("node:path")` and `await import("node:fs/promises")` to avoid bundling issues in the omp harness.
