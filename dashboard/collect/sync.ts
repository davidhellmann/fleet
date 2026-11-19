/**
 * Keeps the data repo (fleet.json `data`) in step across hosts with plain Git: before a run, pull;
 * after it, commit this host's folder and push. Every host writes only `<host>/`, so a rebase never
 * meets a conflict. Failures never stop the collector: a missed pull or push is reported, and the
 * next run pushes what is still waiting. fleet itself is only pulled, never pushed.
 */
import { spawnSync } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  out: string;
}
export type GitRun = (args: string[]) => GitResult;

/** Git in `dir`, never asking for credentials (a background run has nobody to answer). */
export const gitIn = (dir: string): GitRun => (args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

const firstLine = (text: string) => text.split('\n').find((l) => l.trim())?.trim() ?? 'no output';

/** Why `dir` cannot sync (not the top of a clone, no upstream branch), or null when it can. */
export function cannotSync(git: GitRun): string | null {
  const top = git(['rev-parse', '--show-prefix']);
  if (!top.ok) return 'not a Git repo';
  if (top.out !== '') return 'inside another repo, not a clone of its own';
  if (!git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok) return 'its branch has no upstream';
  return null;
}

/** Fetches what the other hosts pushed. On failure the rebase is undone and the run goes on with what is here. */
export function pullData(git: GitRun): string {
  const r = git(['pull', '--rebase', '--autostash', '-q']);
  if (r.ok) return 'pulled';
  git(['rebase', '--abort']);
  return `pull failed: ${firstLine(r.out)}`;
}

/**
 * Brings fleet itself up to date, so this host's global skills (links into this checkout) follow what
 * was pushed. Only a fast-forward on a tree without uncommitted changes: local work is never touched,
 * a branch with commits of its own is left as it is. Names what the pull leaves to do by hand.
 */
export function pullFleet(git: GitRun): string {
  const why = cannotSync(git);
  if (why) return `not updated: ${why}`;
  if (git(['status', '--porcelain', '--untracked-files=no']).out !== '') return 'not updated: uncommitted changes';
  const before = git(['rev-parse', 'HEAD']).out;
  const pull = git(['pull', '--ff-only', '-q']);
  if (!pull.ok) return `not updated: ${firstLine(pull.out)}`;
  const after = git(['rev-parse', 'HEAD']).out;
  if (after === before) return 'up to date';
  const count = Number(git(['rev-list', '--count', `${before}..${after}`]).out) || 0;
  const files = git(['diff', '--name-only', before, after]).out.split('\n');
  const skillDirs = (rev: string) => git(['ls-tree', '-d', '--name-only', rev, 'skills/']).out;
  const todo = [
    (skillDirs(before) !== skillDirs(after) || files.includes('skills.json')) && 'skills added or removed: run scripts/setup.sh',
    (files.includes('package.json') || files.includes('pnpm-lock.yaml')) && 'dependencies changed: run pnpm install',
  ].filter(Boolean);
  return `pulled ${count} commit${count === 1 ? '' : 's'}${todo.length ? `; ${todo.join('; ')}` : ''}`;
}

/**
 * Commits this host's folder when it changed and pushes everything not yet pushed. A push the remote
 * refuses (another host pushed first) gets one pull and one more try.
 */
export function pushData(git: GitRun, host: string, when: string): string {
  git(['add', '-A', '--', host]);
  const changed = !git(['diff', '--cached', '--quiet', '--', host]).ok;
  if (changed) {
    const c = git(['commit', '-q', '-m', `chore(${host}): collect ${when}`, '--', host]);
    if (!c.ok) return `commit failed: ${firstLine(c.out)}`;
  }
  const ahead = Number(git(['rev-list', '--count', '@{u}..HEAD']).out) || 0;
  if (ahead === 0) return changed ? 'committed' : 'nothing new';
  let push = git(['push', '-q']);
  if (!push.ok) {
    const pulled = pullData(git);
    if (pulled !== 'pulled') return `committed, not pushed (${pulled})`;
    push = git(['push', '-q']);
  }
  return push.ok ? `pushed ${ahead} commit${ahead === 1 ? '' : 's'}` : `committed, not pushed: ${firstLine(push.out)}`;
}
