# codexray architecture

## The problem, precisely

The stock OpenAI Codex plugin for Claude Code (`codex@openai-codex`) is opaque
for three compounding reasons found by reading its source
(`~/.claude/plugins/cache/openai-codex/codex/1.0.5`):

1. Its `codex-rescue` agent runs everything through **one blocking Bash call** and
   is explicitly forbidden to poll (`agents/codex-rescue.md`), so nothing returns
   until the process exits.
2. Its runtime **opts out of streaming delta notifications** at initialize time
   (`scripts/lib/app-server.mjs`).
3. It **drops `thread/tokenUsage/updated`** in the default case of its event
   switch (`scripts/lib/codex.mjs`), and stores no token field anywhere.

Separately, an empirical probe of a native Claude Code subagent confirmed the
harness contract: a subagent's `output_file` is a symlink to a huge JSONL
transcript you are told **not** to tail; the parent model sees only the final
message plus a `<usage>` block that measures **the wrapper subagent's own
tokens**, never a delegated child's. So Codex-side tokens must be written to a
separate file by the wrapper no matter what.

## The one channel that works

The probe also confirmed the positive result: a **separate file the wrapper
writes** is fully tail-able by the main session mid-run (`Read` returned
successive appended lines while the subagent was still running). codexray is
built entirely around that channel.

```
main Claude session
   │  Bash run_in_background: codexray run "<task>"
   ▼
codexray (worker)                         files under CLAUDE_PLUGIN_DATA/jobs/
   │  spawn codex exec --json                 <id>.progress.log   ◀── Read (tail)
   │  readline over stdout JSONL               <id>.state.json     ◀── status/result
   │  reduceEvent() → progress + tokens        <id>.result.json    ◀── final answer
   │  finalize on close                        <id>.raw.jsonl      (diagnostic)
   ▼
task exits → Claude auto-notified
```

## Why `codex exec --json` (not app-server)

Both were evaluated against reverse-engineered protocol docs and the installed
binary. Decision: **exec `--json` is the shipping transport.**

- **Stable & supported.** `codex exec --json`'s event schema is documented and is
  exactly what OpenAI's own TypeScript SDK wraps. `codex app-server` is marked
  `[experimental]`, is unversioned, and drifts between releases (two codex
  installs already coexist here: bun 0.142.5 vs nvm 0.134.0).
- **Model/effort are free flags** (`-m`, `-c model_reasoning_effort`) that map 1:1
  to the delegation policy.
- **The channel to the parent is a file regardless.** Because the parent observes
  a wrapper-written file (not a live socket), app-server's per-token deltas would
  collapse into the same file — no richer pipe is gained by the harder transport.
  Per-turn token totals from `turn.completed.usage` are sufficient for a file the
  parent polls at tool-round boundaries.

app-server wins only when you *drop the subagent/file model* and push sub-second
deltas into a live UI (statusline / plugin monitor). That is the documented
upgrade path, not the default. See `app-server-upgrade.md`.

## Event model

`codex exec --json` emits one JSON object per stdout line. `scripts/lib/events.mjs`
reduces them:

| Event | Handling |
|-------|----------|
| `thread.started` | capture session id (for resume) |
| `turn.started` / `turn.completed` | turn count; `usage` → token accumulator |
| `turn.failed` / `error` | mark failed, capture message |
| `item.started` | render actions ($ command, search, mcp) |
| `item.completed` | render message / file changes; collect final answer |

Token accounting (`scripts/lib/tokens.mjs`): per turn `total = input + output`;
across turns, output/total are summed and the last turn's input (context size) is
kept. `cached_input_tokens` is the cached subset of input; `reasoning_output_tokens`
is reported for transparency.

## Files & lifecycle

- Data root: `CODEXRAY_DATA_DIR` → `CLAUDE_PLUGIN_DATA` → `$TMPDIR/codexray`
  (namespaced so it never scatters into another plugin's dir).
- Jobs are lock-free: listing scans the directory; a dead job leaves a readable
  state file, never a corrupt shared index. `pruneJobs` keeps the 50 most recent
  finished jobs and never deletes a running one.
- `SessionEnd` hook cancels this session's running jobs and prunes.

## Verification

- Unit tests over the reducer, token math, arg builder, binary resolver, and job
  store (fixtures; zero LLM cost).
- An integration test drives the full spawn → parse → finalize pipeline through a
  **fake codex** binary replaying a recorded stream.
- A live smoke run against real `codex` (gpt-5.3-codex-spark, read-only) confirmed
  the real `exec --json` schema matches the parser and that real token usage
  (`in=16478 out=27 total=16505`) is captured end-to-end.
