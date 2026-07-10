# Repository Guidelines

## Project Overview

`omp-cmux` is an **oh-my-pi extension** that bridges the omp AI coding agent with **cmux** (a terminal multiplexer). Its product boundary is **Session Visibility**: desktop notifications and sidebar status keep agent progress visible without focusing the session. Session and workspace orchestration are intentionally out of scope; see `CONTEXT.md` and ADR-0001.

## Architecture & Data Flow

```
index.ts (entry: ExtensionFactory)
 ├─ notify.ts  ──> cmux.ts (fire-and-forget notify CLI)
 │              └─> config.ts (environment-based notification policy)
 └─ sidebar.ts ──> cmux.ts (status display commands)

[cmux unavailable] → UI calls return undefined; omp lifecycle continues
```

- **Entry point**: `extensions/cmux/index.ts` exports a single `ExtensionFactory` function.
- **Feature gating**: `isCmuxAvailable()` accepts cmux workspace/tab IDs, a socket path, or the fallback `/tmp/cmux.sock`.
- **Event-driven**: Notify and sidebar modules register handlers on omp lifecycle events (`agent_start`, `agent_end`, `tool_result`, `turn_end`, `session_shutdown`, etc.).
- **Fire-and-forget**: cmux CLI calls never block or throw into the extension flow; failures are silently swallowed.

## Key Directories

| Path | Purpose |
|---|---|
| `extensions/cmux/` | All extension source modules |
| `types/` | TypeScript declaration stubs for oh-my-pi API |
| `extensions/cmux/index.ts` | Extension entry point / factory |
| `extensions/cmux/cmux.ts` | Safe cmux CLI invocation and runtime environment refresh |
| `extensions/cmux/notify.ts` | Desktop notification tracking & dispatch |
| `extensions/cmux/sidebar.ts` | Sidebar status bar management |
| `extensions/cmux/config.ts` | Environment-based notification configuration |

## Development Commands

```bash
# Type-check only (no build, no tests)
bun run typecheck    # tsc --noEmit

# Install dependencies
bun install          # uses bun@1.3.14, declared in package.json#packageManager

# Run the Bun test suite
bun test             # runs extensions/cmux/*.test.ts
```

- **Package manager**: `bun` only. Never use npm, yarn, or pnpm.
- **No build step**: The extension is loaded as raw TypeScript by the omp harness at runtime.

## Code Conventions & Common Patterns

### Module Structure

- **Decoupled modules** — each `.ts` file is a self-contained concern. Never consolidate into a single file.
- **Imports are always absolute** within the extension scope, using `"@oh-my-pi/pi-coding-agent"` for the harness API.
- No barrel files, no re-exports beyond what each module naturally exports.

### Error Handling

- **UI features must never break the main flow**. Use safe wrappers (`safeSendNotification`, `safeSetSidebarState`, `safeClearSidebar`) that wrap calls in try/catch.
- **cmux calls** are `try/catch` guarded and return `undefined` on failure — callers check truthiness.

### Environment-Based Configuration

All config reads from `process.env` with sensible defaults:
- `CMUX_SOCKET_PATH`, `CMUX_WORKSPACE_ID`, `CMUX_TAB_ID` — cmux availability signals
- `OMP_CMUX_NOTIFY_LEVEL` — `"all" | "medium" | "low" | "disabled"` (default `"medium"`)
- `PI_CMUX_NOTIFY_THRESHOLD_MS` — duration before "Waiting for input" notification (default 15000)
- `PI_CMUX_NOTIFY_DEBOUNCE_MS` — debounce window for duplicate notifications (default 3000)

### Timing Constant (cmux.ts)

| Constant | Value | Purpose |
|---|---|---|
| `CMUX_TIMEOUT_MS` | 5000 | cmux CLI call timeout |

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
| `extensions/cmux/cmux.ts` | Safe cmux CLI invocation and environment refresh |

## Runtime/Tooling Preferences

- **Runtime**: Bun 1.3.14 (declared via `packageManager` in `package.json`)
- **TypeScript**: 6.0.3, strict mode, `bundler` module resolution, no emit
- **Features used**: top-level `await` not needed — all async work is in event handlers
- **Node APIs used**: `node:fs` (`existsSync`)

## Testing & QA

- Tests live in `extensions/cmux/*.test.ts` and run with **Bun** (`bun test`).
- Current baseline: 4 test files, 20 passing tests, 47 assertions.
- Type safety is enforced via `strict: true` in tsconfig and the typed stub layer in `types/oh-my-pi-stub.d.ts`.
- The `typecheck` script (`tsc --noEmit`) is also run in CI/local checks.

## Key Design Decisions

1. **Session Visibility only** — sidebar and notification projection belong here; slash commands, split creation, directory jumping, and worktree orchestration do not. See ADR-0001.
2. **Fire-and-forget UI calls** — sidebar and notify cmux invocations use `.catch(() => {})`; they must never block or throw into the extension harness.
3. **Feature gate at every UI call** — `cmux()` resolves current cmux environment state and returns `undefined` when cmux is unavailable.
4. **Summary generation mirrors upstream notification format** — `generateSummary()` produces title/subtitle/body tuples aligned with omp's native notification contracts.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
