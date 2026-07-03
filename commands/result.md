---
description: Print the final Codex answer for a codexray job
argument-hint: "[jobId]"
---

Final Codex result (latest job if no id given):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codexray.mjs" result $ARGUMENTS`

Relay Codex's answer to the user. Do not silently act on it — present it first.
