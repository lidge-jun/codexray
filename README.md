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
3. Claude is auto-notified when the background job exits and reads only the final result. Progress streaming is free -- it is done by the Node process, not by a Claude agent. Optionally, Claude can `Read` the progress file between its own steps, but this is not required.

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

### Option 1: Main-session background run (recommended, token-lean)

Launch `codexray run --json "<task>"` via Bash `run_in_background`. Claude is auto-notified on completion and reads **only** the final `result.json`. Live progress streaming is handled entirely by the codexray Node process (the `codex exec --json` parser) -- it costs **zero** model tokens. You can tail the progress log in a terminal for free, but reading it from the Claude session is optional.

```sh
# Example: launch in background, read result when notified
codexray run "refactor src/foo.ts" --model gpt-5.5 --effort xhigh --json
```

This is the leanest path: no middleman, no token overhead, one read of the result by whoever needs it.

### Option 2: codexray:codex-runner subagent (optional)

`codexray:codex-runner` is a **Haiku-tier thin launcher**. It dispatches the Codex job and returns only a **job handle** (`jobId` + `resultPath`) -- it never pipes the Codex output through itself. Use it only if you specifically want a dispatched-subagent shape; the main-session background run above is leaner.

The skill also auto-triggers on natural-language prompts like:

- "Delegate this refactor to Codex and show me the token usage."
- "Have Codex investigate this bug (read-only) and report back."
- "codexray로 이 모듈 리팩터하고 토큰도 알려줘"

### Option 3: Make it the default

Paste this snippet into your `~/.claude/CLAUDE.md` (global) or a project `CLAUDE.md` so your agent always routes Codex work through codexray:

```markdown
## Delegating to Codex
Route Codex work through codexray. The recommended default is a main-session
background run (`codexray run --json …` via Bash run_in_background) — Claude reads
only the final result, and live streaming is free (handled by the Node process, not
a Claude agent). For a subagent shape, use codexray:codex-runner — a Haiku thin
launcher that returns a job handle only, never piping Codex output through itself.
Pass --model / --effort by task weight (e.g. --model gpt-5.5 --effort high for
substantial work; --model gpt-5.3-codex-spark --effort medium for quick lookups).
Add --sandbox read-only for investigation-only tasks.
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

### Model, effort & speed

Three flags tune the cost/speed/quality trade-off of a codexray run:

| Flag | What it does | Maps to Codex |
|---|---|---|
| `--model <id>` | Codex model to use. `gpt-5.5` for substantial work; `gpt-5.3-codex-spark` (the "spark" model) for fast, low-cost, text-only lookups. | `-m` |
| `--effort <minimal\|low\|medium\|high\|xhigh>` | Reasoning effort. Lower = faster & cheaper; higher = more thorough but slower and pricier. Omit to use the model's own default. | `-c model_reasoning_effort` |
| `--fast` | Request the FAST service tier (`service_tier=fast`) for lower latency where your account supports it. | `service_tier=fast` |

**Ready-to-use presets:**

| Preset | When to use | Flags |
|---|---|---|
| Fast / cheap | Quick lookups, search, simple edits | `--model gpt-5.3-codex-spark --effort low --fast` |
| Substantial | Implementation, deep debugging, design | `--model gpt-5.5 --effort xhigh` |

**Examples:**

```sh
codexray run "find where auth is validated" --model gpt-5.3-codex-spark --effort low --fast --sandbox read-only
codexray run "implement the retry policy" --model gpt-5.5 --effort xhigh
```

These flags also work when dispatching the subagent -- tell `codexray:codex-runner` to use e.g. `--model gpt-5.3-codex-spark --effort low --fast`.

## The drop-in subagent

`codexray:codex-runner` is a drop-in replacement for the old `codex:codex-rescue`. It is a **Haiku-tier thin launcher**: a single Agent dispatch starts the Codex job and returns a **job handle** (`jobId` + `resultPath`) -- it never ingests or relays the full Codex output, so the subagent's own token cost is negligible. The caller reads the result file directly.

## Token cost

The heavy Codex work runs **entirely off your Claude quota** -- it is billed to the Codex/OpenAI side, not to your Anthropic context window. Live progress streaming is done by codexray's Node process (the `codex exec --json` parser), costing **zero** model tokens.

The recommended flow (main-session background run) reads only the final result once. Nothing is piped through a middleman. If you use the `codexray:codex-runner` subagent, it returns only a handle -- it never ingests the Codex output into its own context, so even that path adds near-zero overhead.

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
