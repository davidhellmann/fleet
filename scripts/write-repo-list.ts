/**
 * Writes REPOS.md, the repo list for agents, from fleet.json (in the data repo, else in fleet). Run
 * after changing fleet.json; scripts/setup.sh and every collector run do it too.
 *
 *   node scripts/write-repo-list.ts          write REPOS.md
 *   node scripts/write-repo-list.ts --check  exit 1 if REPOS.md is out of date, change nothing
 */
import { existsSync } from 'node:fs';
import { FLEET_DIR, fleetPaths, loadRepos, readHostConfig, writeRepoList } from './config.ts';

const check = process.argv.includes('--check');

try {
  const paths = fleetPaths(FLEET_DIR, readHostConfig(FLEET_DIR));
  if (!existsSync(paths.list)) throw new Error(`no repo list at ${paths.list}: run scripts/setup.sh, or start one from fleet.example.json`);
  const result = writeRepoList(paths.repoList, loadRepos(paths.list), { check });
  if (result === 'outdated') {
    console.error('REPOS.md: out of date; run node scripts/write-repo-list.ts');
    process.exitCode = 1;
  } else console.log(`REPOS.md: ${result === 'written' ? 'written' : 'up to date'}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
