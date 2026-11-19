/**
 * Plan limits: how much of each usage window is used and when it resets.
 *
 * - Codex logs `rate_limits` with its token counts (primary: the 5-hour window, secondary: the
 *   week); the collector keeps the latest.
 * - Claude Code has no log of them; it passes `rate_limits` to the status line command (Pro and Max,
 *   after the first reply). scripts/claude-statusline.ts appends every change to
 *   .cache/claude-limits.jsonl, which the pages read live.
 */
import { existsSync, readFileSync } from 'node:fs';

export interface LimitWindow {
  /** "5 h", "week", or the window in hours or days. */
  label: string;
  windowMinutes: number | null;
  usedPercent: number;
  /** ISO time the window resets; null when unknown. */
  resetsAt: string | null;
}

export interface PlanLimits {
  app: string;
  /** Plan name when the app logs one ("plus", "prolite"). */
  plan: string | null;
  /** When the values were observed. */
  at: string;
  windows: LimitWindow[];
}

/** "5 h", "week", "30 d"… for a window length. */
export function windowLabel(minutes: number | null): string {
  if (minutes === null) return 'window';
  if (minutes === 300) return '5 h';
  if (minutes === 10_080) return 'week';
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);

/** Seconds or milliseconds since the epoch, or an ISO string, as ISO; null otherwise. */
export function toIso(v: unknown): string | null {
  const n = num(v);
  if (n !== null) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
}

/** Codex `rate_limits` (from a token_count event) at time `at`. */
export function codexLimits(r: Record<string, any> | null | undefined, at: string): PlanLimits | null {
  if (!r) return null;
  const windows: LimitWindow[] = [];
  for (const w of [r.primary, r.secondary]) {
    const used = num(w?.used_percent);
    if (used === null) continue;
    const minutes = num(w.window_minutes);
    windows.push({ label: windowLabel(minutes), windowMinutes: minutes, usedPercent: used, resetsAt: toIso(w.resets_at) });
  }
  return windows.length ? { app: 'codex', plan: typeof r.plan_type === 'string' ? r.plan_type : null, at, windows } : null;
}

/**
 * Claude Code's status line `rate_limits` at time `at`: `five_hour` and `seven_day`, each with a used
 * percentage and a reset time. Field spellings are read loosely, as the input is not versioned.
 */
export function claudeLimits(r: Record<string, any> | null | undefined, at: string): PlanLimits | null {
  if (!r || typeof r !== 'object') return null;
  const windows: LimitWindow[] = [];
  for (const [key, minutes] of [['five_hour', 300], ['seven_day', 10_080]] as const) {
    const w = r[key];
    const used = num(w?.used_percentage ?? w?.used_percent ?? w?.utilization);
    if (used === null) continue;
    windows.push({ label: windowLabel(minutes), windowMinutes: minutes, usedPercent: used, resetsAt: toIso(w.resets_at ?? w.reset_at) });
  }
  return windows.length ? { app: 'claude-code', plan: null, at, windows } : null;
}

/** The latest Claude Code limits from the status line log; null without one. */
export function readClaudeLimits(file: string): PlanLimits | null {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]);
      const limits = claudeLimits(d.rate_limits, d.at);
      if (limits) return limits;
    } catch {}
  }
  return null;
}
