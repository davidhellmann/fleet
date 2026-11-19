/**
 * The committed stats: <data>/<host>/<YYYY-MM>.json (the data repo, fleet.json `data`), one file per host and month, so two hosts never
 * edit the same file. One row per line keeps Git diffs readable.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StatsRow } from './rollup.ts';

export interface StatsFile {
  host: string;
  /** YYYY-MM */
  month: string;
  rows: StatsRow[];
}

export const statsFile = (statsDir: string, host: string, month: string) => join(statsDir, host, `${month}.json`);

/** The file as text: header fields, then one row per line. */
export function formatStats(file: { host: string; month: string; rows: readonly unknown[] }): string {
  const rows = file.rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `{\n  "host": ${JSON.stringify(file.host)},\n  "month": ${JSON.stringify(file.month)},\n  "rows": [${rows ? `\n${rows}\n  ` : ''}]\n}\n`;
}

export function readStats(statsDir: string, host: string, month: string): StatsRow[] {
  const path = statsFile(statsDir, host, month);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data?.rows)) throw new Error(`${path}: expected { rows: [...] }`);
  return data.rows;
}

/** Writes the month; returns whether the file changed. */
export function writeStats(statsDir: string, file: StatsFile): boolean {
  const path = statsFile(statsDir, file.host, file.month);
  const text = formatStats(file);
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  mkdirSync(join(statsDir, file.host), { recursive: true });
  writeFileSync(path, text);
  return true;
}

// Other row files next to the daily rollups: stats/<host>/<prefix>-<YYYY-MM>.json, same layout
// (commits-: commit estimates; amp-threads-: Amp usage per thread and day)

export interface RowsFile<R> {
  host: string;
  month: string;
  rows: R[];
}

export const prefixedFile = (statsDir: string, host: string, prefix: string, month: string) => join(statsDir, host, `${prefix}-${month}.json`);

export function readPrefixed<R>(statsDir: string, host: string, prefix: string, month: string): R[] {
  const path = prefixedFile(statsDir, host, prefix, month);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data?.rows)) throw new Error(`${path}: expected { rows: [...] }`);
  return data.rows;
}

/** Writes one month of a prefixed file; returns whether it changed. */
export function writePrefixed<R>(statsDir: string, prefix: string, file: RowsFile<R>): boolean {
  const path = prefixedFile(statsDir, file.host, prefix, file.month);
  const text = formatStats(file);
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  mkdirSync(join(statsDir, file.host), { recursive: true });
  writeFileSync(path, text);
  return true;
}

/** Every row of a prefixed file kind, every host and month. */
export function readAllPrefixed<R>(statsDir: string, prefix: string): R[] {
  if (!existsSync(statsDir)) return [];
  const rows: R[] = [];
  const name = new RegExp(`^${prefix}-(\\d{4}-\\d{2})\\.json$`);
  for (const host of readdirSync(statsDir, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    for (const f of readdirSync(join(statsDir, host.name))) {
      const m = name.exec(f);
      if (m) rows.push(...readPrefixed<R>(statsDir, host.name, prefix, m[1]));
    }
  }
  return rows;
}

export const readCommits = <R>(statsDir: string, host: string, month: string): R[] => readPrefixed<R>(statsDir, host, 'commits', month);
export const writeCommits = <R>(statsDir: string, file: RowsFile<R>): boolean => writePrefixed(statsDir, 'commits', file);
export const readAllCommits = <R>(statsDir: string): R[] => readAllPrefixed<R>(statsDir, 'commits');

/** Every stored row of every host, for the pages. */
export function readAllStats(statsDir: string): StatsRow[] {
  if (!existsSync(statsDir)) return [];
  const rows: StatsRow[] = [];
  for (const host of readdirSync(statsDir, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    for (const f of readdirSync(join(statsDir, host.name))) {
      const m = /^(\d{4}-\d{2})\.json$/.exec(f);
      if (m) rows.push(...readStats(statsDir, host.name, m[1]));
    }
  }
  return rows;
}
