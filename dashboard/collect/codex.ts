/**
 * Codex reader: token usage from ~/.codex/sessions/YYYY/MM/DD/*.jsonl(.zst). Codex CLI, the Codex
 * app, T3 Code and Zed driving Codex all write here; `originator` in session_meta tells them apart.
 *
 * Newer sessions log one `token_usage_record` per model response (with a unique `response_id`);
 * older ones only `token_count` events with the session's running total, sometimes repeated. Per
 * file the records are used when there are any, else the growth of the running total, so nothing
 * counts twice. The model comes from the latest `turn_context`. Codex logs no Git branch.
 *
 * OpenAI counts cached input inside `input_tokens`; it is moved to cache read here.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { UsageEvent } from './claude.ts';
import { filesUnder } from './files.ts';
import { codexLimits, type PlanLimits } from './limits.ts';

export const CODEX_APP = 'codex';

/** Short client names for Codex originators. */
export function codexClient(originator: unknown): string {
  const o = String(originator ?? '').toLowerCase().replace(/[\s_]+/g, '-');
  if (!o) return 'unknown';
  if (o.includes('t3')) return 't3-code';
  if (o.includes('desktop')) return 'codex-desktop';
  if (o.includes('cli') || o.includes('tui')) return 'cli';
  if (o.includes('exec')) return 'exec';
  return o;
}

interface OpenAiUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Token counts in fleet's terms: input without the cached part, which becomes cache read. */
function counts(u: OpenAiUsage) {
  const cached = n(u.cached_input_tokens);
  return { input: Math.max(0, n(u.input_tokens) - cached), output: n(u.output_tokens), cacheRead: cached, cacheWrite5m: n(u.cache_write_input_tokens), cacheWrite1h: 0 };
}

const minus = (a: OpenAiUsage, b: OpenAiUsage): OpenAiUsage => ({
  input_tokens: n(a.input_tokens) - n(b.input_tokens),
  cached_input_tokens: n(a.cached_input_tokens) - n(b.cached_input_tokens),
  cache_write_input_tokens: n(a.cache_write_input_tokens) - n(b.cache_write_input_tokens),
  output_tokens: n(a.output_tokens) - n(b.output_tokens),
});

const total = (u: OpenAiUsage) => n(u.input_tokens) + n(u.output_tokens);

/** The usage events of one Codex session file, with their dedupe keys. */
export function parseCodexLines(lines: Iterable<string>): { key: string; event: UsageEvent }[] {
  const parsed: Record<string, any>[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {}
  }
  const meta = parsed.find((d) => d.type === 'session_meta')?.payload ?? {};
  const sessionId: string = meta.session_id ?? meta.id ?? 'unknown';
  const client = codexClient(meta.originator);
  const useRecords = parsed.some((d) => d.type === 'token_usage_record');

  const out: { key: string; event: UsageEvent }[] = [];
  let model = 'unknown';
  let cwd: string = meta.cwd ?? '';
  let last: OpenAiUsage = {};
  for (const d of parsed) {
    if (d.type === 'turn_context') {
      if (typeof d.payload?.model === 'string') model = d.payload.model;
      if (typeof d.payload?.cwd === 'string') cwd = d.payload.cwd;
      continue;
    }
    let usage: OpenAiUsage | null = null;
    let key = '';
    if (useRecords && d.type === 'token_usage_record' && d.payload?.usage) {
      usage = d.payload.usage;
      key = d.payload.response_id ?? `${sessionId}:${d.ordinal ?? out.length}`;
    } else if (!useRecords && d.type === 'event_msg' && d.payload?.type === 'token_count' && d.payload.info?.total_token_usage) {
      const now: OpenAiUsage = d.payload.info.total_token_usage;
      // Only growth counts: repeated or reset totals add nothing
      if (total(now) <= total(last)) {
        if (total(now) < total(last)) last = now;
        continue;
      }
      usage = minus(now, last);
      last = now;
      key = `${sessionId}:${d.timestamp}:${total(now)}`;
    }
    if (!usage || typeof d.timestamp !== 'string') continue;
    const c = counts(usage);
    if (c.input + c.output + c.cacheRead + c.cacheWrite5m === 0) continue;
    out.push({ key, event: { app: CODEX_APP, client, sessionId, timestamp: d.timestamp, cwd, branch: null, model, ...c } });
  }
  return out;
}

/** The latest plan limits in one session file (from its token_count events); null without any. */
export function latestCodexLimits(lines: Iterable<string>): PlanLimits | null {
  let latest: { at: string; r: Record<string, any> } | null = null;
  for (const line of lines) {
    if (!line.includes('"rate_limits"')) continue;
    try {
      const d = JSON.parse(line);
      const r = d.payload?.type === 'token_count' ? d.payload.rate_limits : null;
      if (r && typeof d.timestamp === 'string' && (!latest || d.timestamp > latest.at)) latest = { at: d.timestamp, r };
    } catch {}
  }
  return latest ? codexLimits(latest.r, latest.at) : null;
}

export const codexDir = (): string => process.env.CODEX_HOME || join(homedir(), '.codex');

/** Every usage event under `<dir>/sessions`, plain or zstd-compressed, deduplicated; and the latest plan limits. */
export function readCodexLogs(dir = codexDir()): { events: UsageEvent[]; files: number; limits: PlanLimits | null } {
  const byKey = new Map<string, UsageEvent>();
  let files = 0;
  let limits: PlanLimits | null = null;
  for (const suffix of ['.jsonl', '.jsonl.zst']) {
    for (const file of filesUnder(join(dir, 'sessions'), suffix)) {
      files++;
      let text: string;
      try {
        const raw = readFileSync(file);
        text = suffix === '.jsonl.zst' ? zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (const { key, event } of parseCodexLines(lines)) if (!byKey.has(key)) byKey.set(key, event);
      const l = latestCodexLimits(lines);
      if (l && (!limits || l.at > limits.at)) limits = l;
    }
  }
  return { events: [...byKey.values()], files, limits };
}
