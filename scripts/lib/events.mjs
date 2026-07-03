// Codex `exec --json` event model.
//
// The event stream is line-delimited JSON. Each line is one of:
//   thread.started {thread_id}          -> session id (for resume)
//   turn.started                        -> a turn began
//   turn.completed {usage}              -> token usage for the turn
//   turn.failed {error}                 -> turn error
//   item.started  {item}                -> a work item began
//   item.updated  {item}                -> item progressed (usually noisy)
//   item.completed{item}                -> a work item finished
//   error {message}                     -> stream-level error
//
// item.type ∈ agent_message | reasoning | command_execution | file_change |
//             mcp_tool_call | web_search | todo_list | error
//
// reduceEvent() is a pure-ish reducer: it mutates a run-state object and returns
// the human-readable progress lines the event produced. Keeping it separate from
// I/O makes it unit-testable against recorded fixtures with zero LLM cost.

import { emptyUsage, accumulate, formatUsage } from './tokens.mjs';

const ICON = {
  agent_message: '💬',
  reasoning: '🧠',
  command_execution: '⚙️',
  file_change: '✏️',
  mcp_tool_call: '🔌',
  web_search: '🔎',
  todo_list: '📋',
  // item-level "error" items are often non-fatal warnings codex surfaces mid-turn
  // (the turn can still complete); use a warning glyph so they don't read as a
  // job failure. Fatal failures arrive as stream `error` / `turn.failed` events.
  error: '⚠️',
};

/**
 * @typedef {object} RunState
 * @property {string | null} sessionId Codex thread id (for resume)
 * @property {'starting'|'running'|'completed'|'failed'} phase
 * @property {import('./tokens.mjs').UsageAccumulator} usage
 * @property {string[]} messages agent_message texts, in order
 * @property {string[]} commands command_execution commands, in order
 * @property {string[]} filesChanged unique changed file paths
 * @property {string | null} lastError
 * @property {boolean} done
 * @property {boolean} failed
 * @property {number} turns
 */

/** @returns {RunState} */
export function createRunState() {
  return {
    sessionId: null,
    phase: 'starting',
    usage: emptyUsage(),
    messages: [],
    commands: [],
    filesChanged: [],
    lastError: null,
    done: false,
    failed: false,
    turns: 0,
  };
}

/**
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function preview(text, max = 100) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Extract a human message from a Codex error shape (string, {message}, or a
 * JSON-encoded string).
 * @param {unknown} err
 * @returns {string}
 */
export function extractError(err) {
  if (err == null) return '';
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      return extractError(parsed) || err;
    } catch {
      return err;
    }
  }
  if (typeof err === 'object') {
    const e = /** @type {Record<string, unknown>} */ (err);
    if (typeof e.message === 'string') return e.message;
    if (e.error) return extractError(e.error);
  }
  return String(err);
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string[]}
 */
function fileChangePaths(item) {
  const out = [];
  const changes = Array.isArray(item.changes) ? item.changes : [];
  for (const c of changes) {
    if (c && typeof c === 'object') {
      const p = /** @type {Record<string, unknown>} */ (c).path;
      if (typeof p === 'string') out.push(p);
    }
  }
  if (typeof item.path === 'string') out.push(item.path);
  return out;
}

/**
 * Build a progress line for an item lifecycle event, or null to skip.
 * @param {'start'|'done'} phase
 * @param {Record<string, unknown>} item
 * @param {RunState} state
 * @returns {string | null}
 */
function itemLine(phase, item, state) {
  const t = typeof item.type === 'string' ? item.type : 'unknown';
  const icon = ICON[/** @type {keyof typeof ICON} */ (t)] || '•';
  if (phase === 'start') {
    switch (t) {
      case 'command_execution':
        return `${icon} $ ${preview(item.command, 120)}`;
      case 'mcp_tool_call':
        return `${icon} ${preview(`${item.server ?? ''} ${item.tool ?? item.name ?? ''}`, 80)}`;
      case 'web_search':
        return `${icon} search: ${preview(item.query, 80)}`;
      default:
        return null;
    }
  }
  // phase === 'done'
  switch (t) {
    case 'agent_message': {
      const text = preview(item.text, 140);
      return text ? `${icon} ${text}` : null;
    }
    case 'file_change': {
      const paths = fileChangePaths(item);
      for (const p of paths) if (!state.filesChanged.includes(p)) state.filesChanged.push(p);
      return paths.length ? `${icon} ${paths.length} file(s): ${preview(paths.join(', '), 120)}` : null;
    }
    case 'command_execution': {
      const status = typeof item.status === 'string' ? item.status : '';
      return status && status !== 'completed' && status !== 'success'
        ? `${icon} command ${status}: ${preview(item.command, 80)}`
        : null;
    }
    case 'error':
      return `${icon} ${preview(item.message ?? item.text, 140)}`;
    default:
      return null;
  }
}

/**
 * Fold one Codex event into run state; return progress lines it produced.
 * @param {RunState} state
 * @param {unknown} evt
 * @returns {{ lines: string[] }}
 */
export function reduceEvent(state, evt) {
  /** @type {string[]} */
  const lines = [];
  if (!evt || typeof evt !== 'object') return { lines };
  const e = /** @type {Record<string, unknown>} */ (evt);
  const type = typeof e.type === 'string' ? e.type : '';
  const item = e.item && typeof e.item === 'object'
    ? /** @type {Record<string, unknown>} */ (e.item)
    : null;

  switch (type) {
    case 'thread.started': {
      if (typeof e.thread_id === 'string') {
        state.sessionId = e.thread_id;
        lines.push(`session ${e.thread_id}`);
      }
      state.phase = 'running';
      break;
    }
    case 'turn.started': {
      state.turns += 1;
      state.phase = 'running';
      lines.push(`turn ${state.turns} started`);
      break;
    }
    case 'turn.completed': {
      accumulate(state.usage, e.usage);
      lines.push(formatUsage(state.usage));
      break;
    }
    case 'turn.failed': {
      state.failed = true;
      state.phase = 'failed';
      state.lastError = extractError(e.error) || 'turn failed';
      lines.push(`turn failed: ${preview(state.lastError, 160)}`);
      break;
    }
    case 'item.started': {
      const line = item ? itemLine('start', item, state) : null;
      if (line) lines.push(line);
      break;
    }
    case 'item.completed': {
      if (item) {
        const line = itemLine('done', item, state);
        if (line) lines.push(line);
        if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
          state.messages.push(item.text);
        }
        if (item.type === 'command_execution' && typeof item.command === 'string') {
          state.commands.push(item.command);
        }
      }
      break;
    }
    case 'item.updated':
      break;
    case 'error': {
      state.failed = true;
      state.phase = 'failed';
      state.lastError = extractError(e.message ?? e.error) || 'error';
      lines.push(`error: ${preview(state.lastError, 160)}`);
      break;
    }
    default:
      break;
  }
  return { lines };
}

/**
 * The final agent answer is the last non-empty agent_message.
 * @param {RunState} state
 * @returns {string}
 */
export function finalMessage(state) {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m && m.trim()) return m;
  }
  return '';
}
