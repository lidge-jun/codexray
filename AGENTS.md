# AGENTS.md — codexray

A Claude Code plugin that runs Codex via `codex exec --json` with live progress
+ token visibility. Standalone project (Phase 3): commit directly here, no
submodule 2-step.

## Rules

- **English** for all code, comments, docs, and commit messages.
- **Zero runtime dependencies.** TypeScript/@types/node are dev-only; never add a
  runtime dependency without approval. Scripts are ESM `.mjs` run directly by
  node — no build step ships.
- **Types:** JSDoc + `tsc --checkJs` strict. Run `npm run check` (typecheck +
  tests) before claiming done. The integration test uses a fake codex binary —
  never add a test that spends real LLM tokens to CI.
- **Layout:** plugin components live in default dirs (`skills/`, `commands/`,
  `agents/`, `hooks/`, `monitors/`, `.claude-plugin/plugin.json`). Runtime code
  is in `scripts/` (`codexray.mjs` CLI + `lib/`).
- **Job files** live under `CLAUDE_PLUGIN_DATA` (or `CODEXRAY_DATA_DIR`), never in
  the repo. Never read a subagent's transcript symlink — it overflows context.
- **Codex binary** is resolved to an absolute path (`CODEX_BIN` or PATH); the
  shell `codex` alias is bypassed by spawn, so config overrides are re-applied in
  `codex-bin.mjs`.

## Design source of truth

`docs/architecture.md` (design + evidence) and `devlog/plan/00_plan.md` (PABCD
plan). The exec transport is stable and primary; the app-server path in
`docs/app-server-upgrade.md` is a documented, not-yet-shipped upgrade.
