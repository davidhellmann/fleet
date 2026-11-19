/**
 * Amp reader through the signed-in `amp` CLI (fleet never reads a token): `amp usage --details` with
 * a range prints a Markdown report (tier balance, a Models table with the token kinds, Usage by
 * Thread, Daily Recorded Cost). Amp keeps threads on its servers, so there is no local log.
 *
 * - "Recorded cost" is what Amp billed; usage over a linked Claude or ChatGPT subscription records
 *   $0. To compare with the other apps, a model's cost here is its list price from its tokens
 *   (LiteLLM); models without a price or tokens (image, voice) keep their recorded cost.
 * - Usage is per account, not per host: only the host with `"amp": true` in fleet.local.json reads
 *   it, or every host would count it again.
 * - Account and thread lookups share a limit of 60 requests per hour.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LimitWindow, PlanLimits } from './limits.ts';
import type { StatsRow } from './rollup.ts';

const run = promisify(execFile);

export const AMP_APP = 'amp';

export interface AmpModelUsage {
  /** Amp's display name, e.g. "Opus 5.5". */
  name: string;
  /** Price list id, e.g. "claude-opus-5-5". */
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  recordedCost: number;
}

export interface AmpThreadUsage {
  id: string;
  title: string;
  tokens: number;
  /** Included orb hours drawn. */
  orbHours: number;
  recordedCost: number;
}

export interface AmpReport {
  range: { start: string; end: string } | null;
  models: AmpModelUsage[];
  threads: AmpThreadUsage[];
  limits: PlanLimits | null;
}

/** "1,234" → 1234, "$0.45" → 0.45, "34.6h" → 34.6; null when not a number. */
export function amount(cell: string): number | null {
  const s = cell.replace(/\*\*/g, '').replace(/[$,h\s]/g, '').replace(/\(.*$/, '');
  if (s === '' || Number.isNaN(Number(s))) return null;
  return Number(s);
}

/** The lines of the section `## <title>` (up to the next `## `). */
function section(md: string, title: string): string[] {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

/** The first Markdown table in `lines`, as rows keyed by their header (bold totals left out). */
export function table(lines: string[]): Record<string, string>[] {
  const rows = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (rows.length < 2) return [];
  const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]).map((h) => h.toLowerCase());
  return rows
    .slice(2)
    .map(cells)
    .filter((c) => !c[0].startsWith('**'))
    .map((c) => Object.fromEntries(head.map((h, i) => [h, c[i] ?? ''])));
}

/**
 * Amp's model names as price list ids: Claude families get their `claude-` prefix with dashes for
 * dots ("Opus 5.5" → claude-opus-5-5); others are lowercased with dashes ("GPT-6 Astra" → gpt-6-astra).
 */
export function ampModelId(name: string): string {
  const s = name.trim().toLowerCase().replace(/\s+/g, '-');
  const claude = /^(opus|sonnet|haiku|fable)-(.+)$/.exec(s);
  return claude ? `claude-${claude[1]}-${claude[2].replace(/\./g, '-')}` : s;
}

/** The tier line: agent usage in dollars and orb usage in hours, used share and the period end. */
export function parseTier(md: string, at: string): PlanLimits | null {
  const line = md.split('\n').find((l) => /\*\*Amp .+ Tier:\*\*/.test(l));
  if (!line) return null;
  const plan = /\*\*Amp (.+?) Tier:\*\*/.exec(line)?.[1] ?? null;
  const periodEnd = /period \d{4}-\d{2}-\d{2} to (\d{4}-\d{2}-\d{2})/.exec(line)?.[1];
  const resetsAt = periodEnd ? new Date(`${periodEnd}T00:00:00Z`).toISOString() : null;
  const windows: LimitWindow[] = [];
  const agent = /agent usage \$([\d,.]+) of \$([\d,.]+) remaining/.exec(line);
  if (agent) {
    const [left, of] = [amount(agent[1])!, amount(agent[2])!];
    windows.push({ label: 'agent $', windowMinutes: null, usedPercent: of > 0 ? ((of - left) / of) * 100 : 0, resetsAt });
  }
  const orb = /orb usage ([\d,.]+)h of ([\d,.]+)h/.exec(line);
  if (orb) {
    const [left, of] = [amount(orb[1])!, amount(orb[2])!];
    windows.push({ label: 'orb hours', windowMinutes: null, usedPercent: of > 0 ? ((of - left) / of) * 100 : 0, resetsAt });
  }
  return windows.length ? { app: AMP_APP, plan, at, windows } : null;
}

/** Parses a full `amp usage --details` report. */
export function parseAmpReport(md: string, at: string): AmpReport {
  const range = /^Range: (\S+) to (\S+)/m.exec(md);
  const models = table(section(md, 'Models')).flatMap((r): AmpModelUsage[] => {
    const name = r.model ?? '';
    if (!name) return [];
    return [{
      name,
      model: ampModelId(name),
      input: amount(r['uncached input'] ?? '') ?? 0,
      cacheRead: amount(r['cache read'] ?? '') ?? 0,
      cacheWrite: amount(r['cache write'] ?? '') ?? 0,
      output: amount(r.output ?? '') ?? 0,
      recordedCost: amount(r['recorded cost'] ?? '') ?? 0,
    }];
  });
  const threads = table(section(md, 'Usage by Thread')).flatMap((r): AmpThreadUsage[] => {
    const m = /^(.*) \((T-[0-9a-f-]+)\)$/.exec(r.thread ?? '');
    if (!m) return [];
    return [{ id: m[2], title: m[1], tokens: amount(r.tokens ?? '') ?? 0, orbHours: amount(r['included orb hours'] ?? '') ?? 0, recordedCost: amount(r.total ?? '') ?? 0 }];
  });
  return { range: range ? { start: range[1], end: range[2] } : null, models, threads, limits: parseTier(md, at) };
}

/** Runs `amp usage --details` for a range; throws with Amp's message when it fails or prints nothing. */
export async function readAmpUsage(start: string, end: string, amp: (args: string[]) => Promise<string> = async (args) => (await run('amp', args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })).stdout): Promise<AmpReport> {
  const out = await amp(['usage', '--details', '--start', start, '--end', end]);
  if (!out.trim()) throw new Error('amp usage printed nothing');
  if (!/^# Usage/m.test(out)) throw new Error(out.trim().split('\n')[0].slice(0, 200));
  return parseAmpReport(out, new Date().toISOString());
}

/** One Amp thread on one day, as stored in stats/<host>/amp-threads-<YYYY-MM>.json. */
export interface AmpThreadRow {
  day: string;
  host: string;
  thread: string;
  title: string;
  tokens: number;
  orbHours: number;
  recordedCost: number;
}

/**
 * Which local days to read: today and yesterday (still changing), then up to `backfill` days within
 * the last `horizon` days that have neither stored rows nor a note that they were empty, oldest
 * first (Amp drops thread usage after 90 days, so the oldest go first).
 */
export function ampDaysToRead(today: string, known: ReadonlySet<string>, backfill: number, addDays: (d: string, n: number) => string, horizon = 88): string[] {
  const days = [today, addDays(today, -1)];
  const missing: string[] = [];
  for (let i = horizon; i >= 2 && missing.length < backfill; i--) {
    const d = addDays(today, -i);
    if (!known.has(d)) missing.push(d);
  }
  return [...days, ...missing];
}

const roundCost = (usd: number) => Math.round(usd * 10_000) / 10_000;

/**
 * The stats rows of one day's report: one per model, at its list price when it has one and tokens,
 * else at Amp's recorded cost. The day's thread count goes on the row with the most tokens (Amp
 * gives no threads per model), so summing sessions over the day counts each thread once.
 */
export function ampRows(
  report: AmpReport,
  ctx: { day: string; host: string; priceOf: (model: string) => { input: number; output: number; cacheRead: number; cacheWrite5m: number } | null },
): StatsRow[] {
  const used = report.models.filter((m) => m.input + m.cacheRead + m.cacheWrite + m.output > 0 || m.recordedCost > 0);
  const top = used.reduce<AmpModelUsage | null>((best, m) => (!best || m.input + m.cacheRead + m.cacheWrite + m.output > best.input + best.cacheRead + best.cacheWrite + best.output ? m : best), null);
  return used.map((m) => {
    const tokens = m.input + m.cacheRead + m.cacheWrite + m.output;
    const p = tokens > 0 ? ctx.priceOf(m.model) : null;
    const listPrice = p ? m.input * p.input + m.output * p.output + m.cacheRead * p.cacheRead + m.cacheWrite * p.cacheWrite5m : null;
    return {
      day: ctx.day, host: ctx.host, app: AMP_APP, client: AMP_APP, repo: 'other', branch: null, model: m.model,
      sessions: m === top ? report.threads.length : 0,
      input: m.input, output: m.output, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite,
      cost: roundCost(listPrice ?? m.recordedCost),
    };
  });
}

/** The thread rows of one day's report. */
export const ampThreadRows = (report: AmpReport, ctx: { day: string; host: string }): AmpThreadRow[] =>
  report.threads.map((t) => ({ day: ctx.day, host: ctx.host, thread: t.id, title: t.title.slice(0, 120), tokens: t.tokens, orbHours: t.orbHours, recordedCost: t.recordedCost }));

/**
 * Merges freshly read Amp rows into the stored rows of a month. Only days read in this run
 * (`readDays`) change: from `recomputeFrom` on they are replaced, older ones only filled when they
 * have no Amp rows yet. A day that failed to read keeps what was stored. Other apps stay untouched.
 */
export function mergeAmpRows<R extends { day: string; app?: string }>(stored: readonly R[], fresh: readonly R[], readDays: ReadonlySet<string>, recomputeFrom: string, isAmp: (r: R) => boolean = (r) => r.app === AMP_APP): R[] {
  const storedDays = new Set(stored.filter(isAmp).map((r) => r.day));
  const replace = (day: string) => readDays.has(day) && (day >= recomputeFrom || !storedDays.has(day));
  return [...stored.filter((r) => !(isAmp(r) && replace(r.day))), ...fresh.filter((r) => isAmp(r) && replace(r.day))];
}
