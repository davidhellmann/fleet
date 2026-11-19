/**
 * Pi reader: usage from ~/.pi/agent/sessions/--<cwd>--/*.jsonl. The first line is the session header
 * (`type: session`, with `cwd`); every assistant `message` entry carries `usage`, including Pi's own
 * list-price cost, which is taken as is. Entries form a tree, and a forked session repeats its
 * parent's entries, so events are deduplicated by the provider's response id (else session and
 * entry id). Pi logs no Git branch.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageEvent } from './claude.ts';
import { filesUnder } from './files.ts';

export const PI_APP = 'pi';

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** The usage events of one Pi session file, with their dedupe keys. */
export function parsePiLines(lines: Iterable<string>): { key: string; event: UsageEvent }[] {
  const out: { key: string; event: UsageEvent }[] = [];
  let sessionId = 'unknown';
  let cwd = '';
  for (const line of lines) {
    if (!line || (!line.includes('"usage"') && !line.includes('"session"'))) continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === 'session') {
      sessionId = d.id ?? sessionId;
      cwd = d.cwd ?? cwd;
      continue;
    }
    const m = d.message;
    if (d.type !== 'message' || m?.role !== 'assistant' || !m.usage || typeof d.timestamp !== 'string') continue;
    const u = m.usage;
    const write1h = Math.min(n(u.cacheWrite1h), n(u.cacheWrite));
    const event: UsageEvent = {
      app: PI_APP,
      client: 'pi',
      sessionId,
      timestamp: d.timestamp,
      cwd,
      branch: null,
      model: typeof m.model === 'string' && m.model ? m.model : 'unknown',
      input: n(u.input),
      output: n(u.output),
      cacheRead: n(u.cacheRead),
      cacheWrite5m: n(u.cacheWrite) - write1h,
      cacheWrite1h: write1h,
      ...(typeof u.cost?.total === 'number' ? { loggedCost: Math.max(0, u.cost.total) } : {}),
    };
    if (event.input + event.output + event.cacheRead + event.cacheWrite5m + event.cacheWrite1h === 0) continue;
    out.push({ key: m.responseId ?? `${sessionId}:${d.id}`, event });
  }
  return out;
}

export const piDir = (): string => join(homedir(), '.pi', 'agent');

/** Every usage event under `<dir>/sessions`, deduplicated. */
export function readPiLogs(dir = piDir()): { events: UsageEvent[]; files: number } {
  const byKey = new Map<string, UsageEvent>();
  let files = 0;
  for (const file of filesUnder(join(dir, 'sessions'), '.jsonl')) {
    files++;
    for (const { key, event } of parsePiLines(readFileSync(file, 'utf8').split('\n'))) if (!byKey.has(key)) byKey.set(key, event);
  }
  return { events: [...byKey.values()], files };
}
