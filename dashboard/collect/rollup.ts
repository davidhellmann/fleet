/**
 * Daily rollups: usage events summed per day, app, client, repo, branch and model, priced when they
 * are rolled up (so past costs do not move when prices change). And the merge rule that keeps the
 * history when the logs behind it are gone.
 */
import { costOf, type ModelPrice } from './pricing.ts';
import type { UsageEvent } from './claude.ts';

/** One row of stats/<host>/<YYYY-MM>.json. */
export interface StatsRow {
  /** Local calendar day of the host, YYYY-MM-DD. */
  day: string;
  host: string;
  app: string;
  client: string;
  repo: string;
  branch: string | null;
  model: string;
  /** Distinct sessions with a reply on this day in this group. */
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD at API list prices; null when the model has no price. */
  cost: number | null;
}

export interface RollupContext {
  host: string;
  /** Local calendar day of an ISO instant. */
  dayOf: (timestamp: string) => string;
  repoOf: (cwd: string) => string;
  priceOf: (model: string) => ModelPrice | null;
}

const KEY_FIELDS = ['day', 'app', 'client', 'repo', 'branch', 'model'] as const;
const keyOf = (r: Pick<StatsRow, (typeof KEY_FIELDS)[number]>) => KEY_FIELDS.map((k) => r[k] ?? '').join('\u0000');

/** Rows ordered by their key fields, so files diff cleanly. */
export const sortRows = (rows: StatsRow[]): StatsRow[] => rows.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

/** Cost rounded to a hundredth of a cent: enough to compare, short in the files. */
const roundCost = (usd: number) => Math.round(usd * 10_000) / 10_000;

export function rollup(events: readonly UsageEvent[], ctx: RollupContext): StatsRow[] {
  const groups = new Map<string, { row: StatsRow; sessions: Set<string>; cost: number; priced: boolean }>();
  for (const e of events) {
    const base = { day: ctx.dayOf(e.timestamp), app: e.app, client: e.client, repo: ctx.repoOf(e.cwd), branch: e.branch, model: e.model };
    const key = keyOf(base);
    let g = groups.get(key);
    if (!g) {
      g = {
        row: { ...base, host: ctx.host, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null },
        sessions: new Set(),
        cost: 0,
        priced: true,
      };
      groups.set(key, g);
    }
    g.sessions.add(e.sessionId);
    g.row.input += e.input;
    g.row.output += e.output;
    g.row.cacheRead += e.cacheRead;
    g.row.cacheWrite += e.cacheWrite5m + e.cacheWrite1h;
    // A cost the app logged itself wins over the price list
    const price = e.loggedCost === undefined ? ctx.priceOf(e.model) : null;
    if (e.loggedCost !== undefined) g.cost += e.loggedCost;
    else if (price) g.cost += costOf(e, price);
    else g.priced = false;
  }
  return sortRows(
    [...groups.values()].map(({ row, sessions, cost, priced }) => ({
      ...row,
      sessions: sessions.size,
      cost: priced ? roundCost(cost) : null,
    })),
  );
}

/**
 * Merges freshly computed rows of `app` into the stored ones.
 *
 * - Other apps' rows stay untouched.
 * - From `recomputeFrom` on, the logs still hold every session, so the fresh rows replace the stored ones.
 * - Before it, logs may already be cleaned up, so stored rows stay as they are; fresh rows only fill
 *   days that have no stored row of this app yet (the first run, or a new host).
 */
export function mergeRows(stored: readonly StatsRow[], fresh: readonly StatsRow[], app: string, recomputeFrom: string): StatsRow[] {
  const storedDays = new Set(stored.filter((r) => r.app === app).map((r) => r.day));
  const keep = stored.filter((r) => r.app !== app || r.day < recomputeFrom);
  const add = fresh.filter((r) => r.app === app && (r.day >= recomputeFrom || !storedDays.has(r.day)));
  return sortRows([...keep, ...add]);
}
