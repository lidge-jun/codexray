---
description: Delegate a task to Codex with live progress + token visibility
argument-hint: <task for Codex>
---

Delegate this task to Codex and stay in the loop while it runs, following the
`codex-run` skill:

1. Launch it in the background (Bash tool, `run_in_background: true`). Put the
   task after a `--` separator (or pipe it via stdin) so a prompt that starts
   with `--` is never mis-parsed as a flag:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" run --sandbox workspace-write -- "$ARGUMENTS"`
2. Read the background task's output once to capture `jobId` and `progressPath`
   from the `{"codexray":"job",...}` header line.
3. While Codex works, Read `progressPath` to watch live progress and token usage.
4. When notified of completion, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" result <jobId>` and report
   the outcome plus total Codex token usage.

Task: $ARGUMENTS
