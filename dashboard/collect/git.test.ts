import { describe, expect, it } from 'vitest';
import { parseCommit, parseStatus, parseWorktrees } from './git.ts';

describe('git status', () => {
  it('reads branch, upstream, ahead/behind and counts changes', () => {
    const text = [
      '# branch.oid 3bcd0e6c0b276fc8c23da4077635f5e904d85eb5',
      '# branch.head feat/dashboard',
      '# branch.upstream origin/feat/dashboard',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b README.md',
      '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? notes.md',
      '? scratch/',
    ].join('\n');
    expect(parseStatus(text)).toEqual({ branch: 'feat/dashboard', upstream: 'origin/feat/dashboard', ahead: 2, behind: 1, changed: 2, untracked: 2, conflicts: 1 });
  });

  it('handles a detached head and a branch without upstream', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n')).toMatchObject({ branch: null, upstream: null, ahead: null, behind: null, changed: 0 });
  });
});

describe('git worktrees', () => {
  it('lists the other worktrees with their branch', () => {
    const text = [
      'worktree /repos/my-plugin', 'HEAD abc', 'branch refs/heads/main', '',
      'worktree /repos/my-plugin-2.x', 'HEAD def', 'branch refs/heads/2.x', '',
      'worktree /repos/my-plugin-tmp', 'HEAD 123', 'detached', '',
    ].join('\n');
    expect(parseWorktrees(text, '/repos/my-plugin/')).toEqual([
      { path: '/repos/my-plugin-2.x', branch: '2.x' },
      { path: '/repos/my-plugin-tmp', branch: null },
    ]);
  });
});

describe('git log', () => {
  it('reads the last commit', () => {
    expect(parseCommit('abc\u001ffeat: add x\u001f2026-11-18T21:00:00+01:00\u001fAlex\n')).toEqual({ hash: 'abc', subject: 'feat: add x', date: '2026-11-18T21:00:00+01:00', author: 'Alex' });
    expect(parseCommit('')).toBeNull();
  });
});
