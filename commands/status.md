---
description: Show live status + progress tail of a codexray job
argument-hint: "[jobId]"
---

Current codexray job status (latest job if no id given):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" status $ARGUMENTS`

Summarize the phase and current Codex token usage for the user. If the job is
still running, offer to keep watching.
