<p align="center">
  <img src="assets/banner.png" alt="codexray" width="720" />
</p>

<h1 align="center">codexray</h1>
<p align="center"><strong>X-ray vision into a Codex run from Claude Code.</strong></p>

<p align="center">
  <a href="https://github.com/lidge-jun/codexray/releases"><img src="https://img.shields.io/github/v/release/lidge-jun/codexray?label=release&color=blue" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen" alt="Node >= 18.17" />
  <a href="https://lidge-jun.github.io/codexray/"><img src="https://img.shields.io/badge/docs-live%20site-blueviolet" alt="Live Site" /></a>
</p>

---

## Quick start

**Two commands, zero config:**

```
/plugin marketplace add lidge-jun/codexray
/plugin install codexray
```

Verify the install:

```
codexray doctor
```

**Requirements:** Node >= 18.17 and the `codex` CLI on `PATH` (or set `CODEX_BIN`).

---

## Why

The stock `codex:codex-rescue` plugin drives Codex through one blocking Bash call, opts out of streaming notifications, and drops the `thread/tokenUsage/updated` event entirely. Result: you see **nothing** until it exits, and you **never** see Codex's real token usage.

codexray fixes both problems by making the **one channel that actually works** first-class: a tail-able progress file the main Claude session reads on demand, plus a machine-readable state file that includes real Codex token usage.

## How it works

```
Claude Code ──run──> codexray ──> codex exec --json ──> progress.log + state.json ──tail──> Claude
```

1. Claude launches `codexray run "<task>"` in the background (`run_in_background: true`), so it never blocks.
2. codexray spawns `codex exec --json`, parses the JSONL event stream, and writes:
   - `<job>.progress.log` -- one human-readable line per event, tail-able live.
   - `<job>.state.json` -- status, phase, session id, and cumulative token usage.
   - `<job>.result.json` -- final answer + usage + changed files, on completion.
3. Claude `Read`s the progress file between its own steps to watch it live, and is auto-notified when the background job exits.

## Install

```
/plugin marketplace add lidge-jun/codexray
/plugin install codexray
```

**Requirements:** Node >= 18.17 and the `codex` CLI on `PATH` (or set `CODEX_BIN`). Verify with:

```
codexray doctor
```

## Configure your agent

### Option 1: Zero config (just ask)

The `codexray:codex-runner` skill auto-triggers. Use natural-language prompts like:

- "Delegate this refactor to Codex and show me the token usage."
- "Have Codex investigate this bug (read-only) and report back."
- "codexray로 이 모듈 리팩터하고 토큰도 알려줘"

### Option 2: Make it the default

Paste this snippet into your `~/.claude/CLAUDE.md` (global) or a project `CLAUDE.md` so your agent always routes Codex work through codexray:

```markdown
## Delegating to Codex
Route Codex work through the codexray:codex-runner subagent (via the Agent tool)
so runs are observable — one dispatch returns the final answer plus real Codex
token usage. Pass --model / --effort by task weight (e.g. --model gpt-5.5 --effort
high for substantial work; --model gpt-5.3-codex-spark --effort medium for quick
lookups). Add --sandbox read-only for investigation-only tasks. For live progress
in your current session, run `codexray run …` via Bash run_in_background and tail
the progress file it reports.
```

## Usage

### Slash commands

| Command | Action |
|---|---|
| `/codexray:run <task>` | Delegate a task to Codex with live progress + tokens |
| `/codexray:status [jobId]` | Status + progress tail (latest job if omitted) |
| `/codexray:result [jobId]` | Final Codex answer |
| `/codexray:cancel [jobId]` | Stop a running job |

### CLI

```sh
codexray run "refactor src/foo.ts" --model gpt-5.5 --effort high --sandbox workspace-write
codexray status            # latest job + progress tail
codexray result            # final answer + tokens
codexray watch --follow    # stream live progress
codexray list              # all jobs
codexray cancel            # stop latest job
codexray doctor            # environment check
```

### Run options

| Flag | Description |
|---|---|
| `--model <id>` | Codex model (maps 1:1 to Codex `-m` flag) |
| `--effort <minimal\|low\|medium\|high\|xhigh>` | Reasoning effort level |
| `--sandbox <read-only\|workspace-write\|danger-full-access>` | Sandbox mode (default `workspace-write`) |
| `--resume <sessionId>` / `--resume-last` | Continue a previous Codex thread |
| `--fast` | Use `service_tier=fast` |
| `--output-schema <file>` | Structured final answer (JSON Schema) |
| `--detach` | Return a job id immediately (used by slash commands) |
| `--json` | Machine-readable output |

## The drop-in subagent

`codexray:codex-runner` is a drop-in replacement for the old `codex:codex-rescue`. A single Agent dispatch runs the entire Codex task and returns the final answer **plus** real Codex token usage -- no extra polling needed from the caller.

## Tokens

Every `status` and `result` carries a `usage` object with real Codex-side token counts:

```json
{
  "input_tokens": 16478,
  "cached_input_tokens": 3328,
  "output_tokens": 27,
  "reasoning_output_tokens": 20,
  "total_tokens": 16505
}
```

This is the Codex-side usage the stock plugin cannot show you.

## Transport

The default transport is `codex exec --json` -- the stable, documented surface that OpenAI's own SDK wraps. A richer live `codex app-server` path (sub-second deltas, statusline integration) is documented as an upgrade in [`docs/app-server-upgrade.md`](docs/app-server-upgrade.md).

## Development

**Zero runtime dependencies.** ESM `.mjs` runtime with JSDoc types checked by `tsc --checkJs`. TypeScript is dev-only.

```sh
npm run typecheck   # tsc --noEmit
npm test            # node --test (28 tests: unit + fake-codex integration)
npm run check       # both
npm run doctor      # environment check
```

## License

[MIT](LICENSE)
