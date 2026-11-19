/**
 * .cache/snapshot.json: what the collector last read from sources that need the network (GitHub
 * through gh). Not committed; the pages show how old it is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GoneBranch, Uncommitted } from './commits.ts';
import type { RepoGithub } from './github.ts';
import type { PlanLimits } from './limits.ts';
import type { SiteCheck } from './sites.ts';

export interface Snapshot {
  /** ISO time of the GitHub read. */
  githubAt?: string;
  /** Pull requests, issues and alerts per repo name (fleet.json names, and `fleet`). */
  github?: Record<string, RepoGithub>;
  /** The signed-in GitHub user. */
  githubViewer?: string | null;
  /** Work after the last commit per repo and branch, from the last collector run. */
  uncommitted?: Uncommitted[];
  /** Cost on branches git no longer has, so no commit can take it. */
  goneBranches?: GoneBranch[];
  uncommittedAt?: string;
  /** Codex plan limits as last logged (Claude Code's come live from .cache/claude-limits.jsonl). */
  codexLimits?: PlanLimits | null;
  /** Reachability and certificates of the sites in fleet.json. */
  sites?: SiteCheck[];
  sitesAt?: string;
  /** Last Amp read (the CLI allows 60 lookups an hour), its tier limits and error. */
  ampAt?: string;
  ampLimits?: PlanLimits | null;
  ampError?: string | null;
  /** Local days Amp reported without any usage, so they are not read again. */
  ampEmptyDays?: string[];
}

export function readSnapshot(file: string): Snapshot {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

/** Merges `part` into the stored snapshot, keeping the other sources. */
export function writeSnapshot(file: string, part: Snapshot) {
  const next = { ...readSnapshot(file), ...part };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}
