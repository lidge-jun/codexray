# Upgrade path: `codex app-server` for live deltas

codexray ships on `codex exec --json` because it is the stable, SDK-backed
surface. This document specifies the optional upgrade to `codex app-server` for
sub-second, model-visible streaming — take it only when a live UI (statusline or
plugin monitor pushing into the conversation) needs finer granularity than a
file the parent polls.

## What app-server adds

`codex app-server` is a long-lived JSON-RPC 2.0 server (newline-delimited JSON
over stdio, or `--listen ws://…`). Over `exec --json` it adds:

- `item/agentMessage/delta`, `item/reasoning/textDelta`,
  `item/commandExecution/outputDelta` — incremental text/reasoning/output.
- **`thread/tokenUsage/updated`** — token usage pushed during a turn, not only at
  `turn.completed`. (`account/rateLimits/updated` for quota.)
- `turn/steer` (inject input mid-turn) and `turn/interrupt`.
- Per-turn `model` / `effort` / `sandbox` overrides in `turn/start`.

## What it costs

- **Experimental / unversioned.** Regenerate types per installed CLI:
  `codex app-server generate-ts --out <dir> --experimental`. Gate startup on a
  version check.
- **Reverse ServerRequests are mandatory.** `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, and ~5 others MUST be answered or the turn
  stalls. Decide an approval policy (auto-accept within sandbox, or surface to the
  Claude session as a permission prompt) — do not silently auto-accept everything.

## Reference implementation

Port `cli-jaw/src/agent/codex-app-client.ts` (~275 lines, EventEmitter + readline
only) and `codex-app-events.ts` (notification → normalized event mapper, already
handles `item/agentMessage/delta`, reasoning deltas, and
`thread/tokenUsage/updated`). OpenAI's Python SDK
(`sdk/python/src/codex_app_server/client.py`) is a full typed reference including
an `approval_handler` callback.

## Integration shape in codexray

1. Add `scripts/lib/app-server-runner.mjs` mirroring `exec-runner.mjs`'s public
   contract: same `executeRun(state, opts)` signature, same
   progress-file/state-file/result-file outputs, so the CLI, job store, skill, and
   monitor are unchanged.
2. Normalize app-server notifications into the **same** progress lines and the
   same `usage` shape `events.mjs` already produces — the file contract is the
   stable seam; the transport is swappable behind it.
3. Select transport with `--transport app-server|exec` (default `exec`); keep a
   `codex app-server daemon version` compatibility check.
4. Enable the plugin monitor (`monitors/monitors.json`) for genuine model-visible
   push, since app-server can now feed sub-second lines.

## When NOT to bother

If "who watches" is the human via the agent panel/statusline, or the orchestrating
model polling a file at tool-round boundaries, `exec --json` already delivers
item-level progress and per-turn tokens. app-server's advantage is real only for a
continuous live UI consuming sub-second deltas.
