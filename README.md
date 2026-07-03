# codexray

**X-ray vision into a Codex run from Claude Code.** Run OpenAI Codex as a
delegated task and watch it live — every command, message, file change, and
**Codex token count** — instead of a blind blocking call that returns only at
the end.

```
Claude Code ──run──▶ codexray ──▶ codex exec --json ──▶ progress.log + state.json (tokens!) ──tail──▶ Claude
```

## Why

The stock `codex:codex-rescue` plugin drives Codex through one blocking Bash call
whose subagent is *forbidden to poll*, and it opts out of Codex's streaming
notifications and drops the `thread/tokenUsage/updated` event entirely. Result:
you see nothing until it exits, and you never see Codex's token usage — Claude
Code's own accounting only ever measures the wrapper subagent, never the Codex
child.

codexray fixes both by making the **one channel that actually works** first-class:
a separate, human-readable **progress file the main session tails on demand**,
plus a machine-readable **state file that includes real Codex token usage**
parsed from `codex exec --json`'s `turn.completed` event.

## How it works

1. Claude launches `codexray run "<task>"` in the background (Bash
   `run_in_background: true`), so it never blocks.
2. codexray spawns `codex exec --json`, parses the JSONL event stream, and writes:
   - `<job>.progress.log` — one human-readable line per event, tail-able live.
   - `<job>.state.json` — status, phase, session id, and cumulative token usage.
   - `<job>.result.json` — final answer + usage + changed files, on completion.
3. Claude `Read`s the progress file between its own steps to watch it live, and
   is auto-notified when the background job exits.

The transport is `codex exec --json` — the stable surface OpenAI's own SDK wraps.
A richer live `codex app-server` path is documented as an upgrade in
[`docs/app-server-upgrade.md`](docs/app-server-upgrade.md).

## Install (as a Claude Code plugin)

Point a marketplace at this repo, then:

```
/plugin marketplace add <owner>/codexray
/plugin install codexray
```

Requirements: Node ≥ 18.17 and the `codex` CLI on `PATH` (or set `CODEX_BIN`).
Run `codexray doctor` to verify.

## Usage

From a Claude session, the `codex-run` skill and these slash commands are available:

| Command | Action |
|---------|--------|
| `/codexray:run <task>` | Delegate a task to Codex with live progress + tokens |
| `/codexray:status [jobId]` | Status + progress tail (latest job if omitted) |
| `/codexray:result [jobId]` | Final Codex answer |
| `/codexray:cancel [jobId]` | Stop a running job |

Directly on the CLI:

```
codexray run "refactor src/foo.ts" --model gpt-5.5 --effort high --sandbox workspace-write
codexray status            # latest job + progress tail
codexray result            # final answer + tokens
codexray watch --follow    # stream live progress
codexray list
codexray doctor
```

### Run options

- `--model <id>` / `--effort <minimal|low|medium|high|xhigh>` — map 1:1 to Codex
  flags, so your session's model policy carries over.
- `--sandbox <read-only|workspace-write|danger-full-access>` (default
  `workspace-write`); `--read-only` is a shortcut.
- `--resume <sessionId>` / `--resume-last` — continue a Codex thread.
- `--fast` — `service_tier=fast`.
- `--output-schema <file>` — structured final answer (JSON Schema).
- `--detach` — self-detach and return a job id immediately (for slash commands).
- `--json` — machine-readable output.

## Tokens

Every job's `status`/`result` carries `usage`:

```json
{ "turns": 1, "input_tokens": 16478, "cached_input_tokens": 3328,
  "output_tokens": 27, "reasoning_output_tokens": 20, "total_tokens": 16505 }
```

This is the Codex-side usage the stock plugin cannot show you.

## Development

Zero runtime dependencies. TypeScript is dev-only (JSDoc types checked with
`tsc --checkJs`).

```
npm run typecheck   # tsc --noEmit
npm test            # node --test (unit + a fake-codex integration test)
npm run check       # both
npm run doctor      # environment check
```

## License

MIT
