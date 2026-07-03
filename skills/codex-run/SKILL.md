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

The stock `codex:codex-rescue` subagent runs Codex through a single blocking
Bash call and is forbidden to poll, so you see nothing until it exits and never
see Codex's token usage. `codexray` fixes both: it runs `codex exec --json` and
writes a **tail-able progress file** plus a **machine-readable state file that
includes Codex token usage**, which you Read while the run is in flight.

## The one channel that works (verified)

A subagent's transcript is a huge JSONL file you must NOT dump. The only clean
live channel is a **separate progress file you Read on demand**. codexray writes
exactly that. Drive it from the MAIN session (not a blind subagent).

## Protocol

1. **Launch in the background** with the Bash tool, `run_in_background: true`:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" run \
     --model <model> --effort <minimal|low|medium|high|xhigh> \
     --sandbox <read-only|workspace-write|danger-full-access> \
     "<the full task for Codex>"
   ```

   For a long task, pipe it via stdin instead of quoting it as an argument.
   `run_in_background: true` means this does NOT block you — you keep working.

2. **Learn the progress path.** The launch prints a one-line JSON header on
   stderr: `{"codexray":"job","jobId":"cxr-…","progressPath":"…","resultPath":"…"}`.
   Read the background task's output file once to capture `jobId` and
   `progressPath`. (Or run `codexray status --json` to get the latest job.)

3. **Watch it live.** Between your own steps, `Read` the `progressPath`. Each
   line is one Codex event — `$` commands, `💬` messages, `✏️` file changes, and
   a `tokens in=… out=… total=…` line after every turn. This is real live
   progress and real Codex token usage in your context.

4. **Finish.** When the background task completes you are auto-notified. Read the
   final answer from the task output, or run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" result <jobId>
   ```

5. **Report** the outcome AND the total Codex token usage (`status`/`result`
   both carry `usage.total_tokens`) to the user.

## Control

- `codexray status [jobId]` — status + progress tail (latest job if omitted).
- `codexray result [jobId]` — final Codex answer (`--json` for structured).
- `codexray cancel [jobId]` — stop a running job.
- `codexray list` — recent jobs with token totals.
- `codexray doctor` — verify the codex binary, version, and data dir.

## Notes

- Model/effort map 1:1 to Codex flags (`-m`, `-c model_reasoning_effort`), so the
  session's model policy carries over unchanged.
- Default sandbox is `workspace-write`. Use `--sandbox read-only` for a
  non-mutating investigation; `danger-full-access` bypasses the sandbox.
- Resume a prior Codex thread with `--resume <sessionId>` or `--resume-last`.
- The transport is `codex exec --json` (stable, OpenAI-SDK-backed). A richer
  live `codex app-server` path is documented in `docs/app-server-upgrade.md`.
