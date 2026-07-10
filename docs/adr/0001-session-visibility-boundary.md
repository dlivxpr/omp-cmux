---
status: accepted
---

# Limit omp-cmux to session visibility

omp-cmux retains cmux sidebar state and desktop notifications as Session Visibility, but removes slash commands that create or place sessions, shell commands, directory jumps, or git worktrees. Session Orchestration was not used, broadened the extension's maintenance surface, and duplicated workflows already available directly through cmux, zoxide, and git; because there are no external consumers, the removal is a clean cutover without disabled code, deprecation aliases, or compatibility shims.
