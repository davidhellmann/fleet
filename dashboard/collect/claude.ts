/**
 * Claude Code reader: token usage from the session logs, ~/.claude/projects/<encoded-cwd>/**.jsonl
 * (subagents in subfolders). Claude Code, Claude Desktop and apps driving it through the SDK
 * (T3 Code, Delta) all write here; `entrypoint` tells them apart.
 *
 * One assistant message is logged several times: once per content block, and again when a session
 * is resumed into a new file. The copies share `message.id` + `requestId`; their usage is equal
 * except output tokens, which grow while the reply streams. So events are deduplicated across all
 * files by that key, keeping the highest value of every count.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { filesUnder } from './files.ts';

/** Token usage of one model reply. */
export interface UsageEvent {
  app: string;
  /** The program that ran the session, e.g. claude-desktop, t3-code, cli, sdk-ts. */
  client: string;
  sessionId: string;
  /** ISO instant of the reply. */
  timestamp: string;
  cwd: string;
  branch: string | null;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes kept 5 minutes and 1 hour; priced differently. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** Cost the app logged itself (Pi); taken as is instead of the price list. */
  loggedCost?: number;
}

export const CLAUDE_APP = 'claude-code';

const COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** The usage event of one log line, with its dedupe key; null for anything else. */
export function parseClaudeLine(line: string): { key: string; event: UsageEvent } | null {
  // Cheap filter first: most lines are not model replies
  if (!line.includes('"usage"')) return null;
  let d: Record<string, any>;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (d?.type !== 'assistant') return null;
  const m = d.message;
  const u = m?.usage;
  const model = m?.model;
  if (!u || typeof model !== 'string' || !model || model.startsWith('<')) return null;
  if (typeof m.id !== 'string' || typeof d.requestId !== 'string' || typeof d.timestamp !== 'string') return null;

  const split = u.cache_creation;
  const write1h = num(split?.ephemeral_1h_input_tokens);
  // Without the split, every cache write counts as a 5-minute one
  const write5m = split ? num(split.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens);

  const event: UsageEvent = {
    app: CLAUDE_APP,
    client: typeof d.entrypoint === 'string' && d.entrypoint ? d.entrypoint : 'unknown',
    sessionId: typeof d.sessionId === 'string' ? d.sessionId : 'unknown',
    timestamp: d.timestamp,
    cwd: typeof d.cwd === 'string' ? d.cwd : '',
    branch: typeof d.gitBranch === 'string' && d.gitBranch ? d.gitBranch : null,
    model,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
  };
  if (COUNTS.every((k) => event[k] === 0)) return null;
  return { key: `${m.id}\u0000${d.requestId}`, event };
}

/** Adds the events of `lines` to `into`, merging copies of the same reply (highest count wins). */
export function collectClaudeLines(lines: Iterable<string>, into: Map<string, UsageEvent>) {
  for (const line of lines) {
    const parsed = parseClaudeLine(line);
    if (!parsed) continue;
    const seen = into.get(parsed.key);
    if (!seen) into.set(parsed.key, parsed.event);
    else for (const k of COUNTS) seen[k] = Math.max(seen[k], parsed.event[k]);
  }
}

/** Where Claude Code keeps its data: CLAUDE_CONFIG_DIR or ~/.claude. */
export const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

/** Days Claude Code keeps transcripts (`cleanupPeriodDays` in its settings, default 30). */
export function claudeRetentionDays(dir = claudeDir()): number {
  try {
    const days = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).cleanupPeriodDays;
    if (typeof days === 'number' && days > 0) return days;
  } catch {}
  return 30;
}

/** Every usage event in the logs under `<dir>/projects`, deduplicated. */
export function readClaudeLogs(dir = claudeDir()): { events: UsageEvent[]; files: number } {
  const byKey = new Map<string, UsageEvent>();
  let files = 0;
  for (const file of filesUnder(join(dir, 'projects'), '.jsonl')) {
    files++;
    collectClaudeLines(readFileSync(file, 'utf8').split('\n'), byKey);
  }
  return { events: [...byKey.values()], files };
}
