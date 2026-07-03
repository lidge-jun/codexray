# 00 — codexray plan (PABCD)

## Goal

A production Claude Code plugin that runs Codex with **live progress + token
visibility**, replacing the opacity of `codex:codex-rescue`.

## Evidence base (why this design)

Two research workflows + reverse-engineering of local sources + one empirical
subagent probe established:

- The stock codex plugin already speaks `codex app-server` but **opts out of
  deltas and drops `thread/tokenUsage/updated`**; its rescue subagent is a
  blocking, no-poll Bash forwarder → total opacity by construction.
- A native subagent's only parent-visible channels are its **final message** and a
  **transcript symlink you must not tail**; the `<usage>` it reports is the
  *wrapper's* tokens, never a delegated child's. → Codex tokens must be written to
  a separate file by the wrapper.
- A **separate wrapper-written file IS tail-able live** from the main session
  (probe Read successive appended lines mid-run). → build around that file.
- `codex exec --json` is the stable, OpenAI-SDK-backed transport; `app-server` is
  experimental/unversioned with real drift (0.142.5 vs 0.134.0 coexisting). →
  ship exec, document app-server as an upgrade.

## Architecture (Part 1 — plain)

Claude launches `codexray run` in the background; codexray runs `codex exec
--json`, turns the event stream into a human-readable progress file + a state
file that includes Codex token usage; Claude tails the file live and is notified
on completion. Full design: `docs/architecture.md`.

## Files (Part 2 — precise)

- `.claude-plugin/plugin.json`, `package.json`, `tsconfig.json` — manifest + dev toolchain.
- `scripts/lib/`: `paths` · `log` · `codex-bin` (abs-path + version) · `tokens`
  (usage accumulation) · `events` (JSONL reducer) · `job-store` · `exec-runner`
  (spawn + drive) · `render` · `index`.
- `scripts/codexray.mjs` — CLI: `run|status|result|cancel|watch|list|doctor|_worker`.
- `scripts/session-hook.mjs` + `hooks/hooks.json` — session env + cleanup.
- `skills/codex-run/SKILL.md` — the golden-path usage contract.
- `commands/{run,status,result,cancel}.md` — slash commands.
- `agents/codex-runner.md` — optional launcher subagent (returns a handle, never blocks).
- `monitors/monitors.json` — optional live-push monitor (app-server-era).
- `docs/{architecture,app-server-upgrade}.md`, `tests/`.

## Work-phases (PABCD passes)

| Phase | Outcome | Status |
|-------|---------|--------|
| 0 | Scaffold + config + plan | done |
| 1 | Core runtime (bin/events/tokens/exec-runner/job-store) + unit tests | done |
| 2 | Plugin surface (skill/commands/agent/hooks/monitor) | done |
| 3 | Verification (typecheck, unit + fake-codex integration, live smoke) + docs | done |

## Verification record

- `npm run typecheck` → exit 0.
- `node --test` → 25/25 pass (reducer, tokens, args, bin, job-store, integration).
- Live smoke: real `codex` (gpt-5.3-codex-spark, read-only) → `status=completed`,
  `message="pong"`, real usage `in=16478 out=27 total=16505` captured. The real
  `exec --json` schema matched the parser.

## Follow-ups (not blocking v0.1)

- Implement `app-server-runner.mjs` behind `--transport` (see upgrade doc).
- Optional opencodex quota surfacing (`/api/codex-auth/quota`) in `doctor`.
- Publish a marketplace manifest for `/plugin marketplace add`.
