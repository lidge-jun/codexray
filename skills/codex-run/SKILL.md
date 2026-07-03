---
name: codex-run
description: >
  Delegate a coding/analysis task to OpenAI Codex from Claude Code WITH live
  progress and token visibility. Use whenever you would hand work to Codex and
  want to watch it run instead of a blind blocking call. Triggers: "codex로
  돌려", "codex에 맡겨", "delegate to codex", "run codex", "codex로 구현",
  "codex 진행상황", "codex 토큰".
---

# codex-run — observable Codex delegation

`codexray` wraps `codex exec --json`, writing a **tail-able progress file** and
a **machine-readable state file with Codex token usage**. The Node process does
all streaming/parsing — watching a run costs ZERO Claude model tokens.

## Recommended path: main-session background run

Launch from the MAIN session. Do NOT pipe through a subagent middleman — it
would ingest the full prompt AND full output into its own context for no added
value.

### Protocol

1. **Launch** with `run_in_background: true`:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" run \
     --model <model> --effort <minimal|low|medium|high|xhigh> \
     --sandbox <read-only|workspace-write|danger-full-access> \
     -- "<the full task for Codex>"
   ```

   Put the task after `--` (everything after it is taken verbatim). For a long
   task, pipe via stdin: `echo "<task>" | codexray run …`.

2. **Continue working.** The run is non-blocking. Do NOT Read the verbose
   progress file — that log is free to tail in a separate terminal but reading
   it into context wastes tokens. Only read it if the user explicitly asks for
   live status.

3. **Read the final result only.** When the background task completes (you are
   auto-notified), read the task output or run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" result <jobId>
   ```

   This is the single read that matters — one pass, zero waste.

4. **Report** the outcome AND total Codex token usage (`status`/`result` both
   carry `usage.total_tokens`) to the user.

## Secondary option: codexray:codex-runner subagent

`codexray:codex-runner` is a **haiku thin launcher**. It starts the job and
returns ONLY a handle (`jobId` + `resultPath`) — it never pipes the Codex
output through itself. Use it only when you specifically want a dispatched-
subagent shape (e.g., fire-and-forget while you continue heavy work). The main
session still reads the final result itself via the returned `resultPath`.

## Control

- `codexray status [jobId]` — status + progress tail (latest job if omitted).
- `codexray result [jobId]` — final Codex answer (`--json` for structured).
- `codexray cancel [jobId]` — stop a running job.
- `codexray list` — recent jobs with token totals.
- `codexray doctor` — verify the codex binary, version, and data dir.

## Model, effort & speed

Three knobs (all `codexray run` flags, mapping 1:1 to Codex):

| Flag | What it controls | Codex equivalent |
|------|-----------------|------------------|
| `--model <id>` | Codex model | `-m` |
| `--effort <minimal\|low\|medium\|high\|xhigh>` | Reasoning effort. Lower = faster/cheaper; higher = more thorough. | `-c model_reasoning_effort` |
| `--fast` | Request the FAST service tier (`service_tier=fast`) for lower latency. | (service tier) |

**Two presets — pick by task weight:**

- **Fast / cheap** (quick lookups, search, simple edits):
  `--model gpt-5.3-codex-spark --effort low --fast`
- **Substantial** (implementation, deep debugging, design):
  `--model gpt-5.5 --effort xhigh`

Example commands:

```
codexray run "find where auth is validated" --model gpt-5.3-codex-spark --effort low --fast --sandbox read-only
codexray run "implement the retry policy" --model gpt-5.5 --effort xhigh
```

## Notes
- Default sandbox is `workspace-write`. Use `--sandbox read-only` for a
  non-mutating investigation; `danger-full-access` bypasses the sandbox.
- Resume a prior Codex thread with `--resume <sessionId>` or `--resume-last`.
- The transport is `codex exec --json` (stable, OpenAI-SDK-backed). A richer
  live `codex app-server` path is documented in `docs/app-server-upgrade.md`.
