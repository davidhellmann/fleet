/**
 * Reports, per repo, which of the files that agent environments read are there: what a fresh
 * environment (an Amp orb, a Delta Cloud Runner, a server) needs to set the repo up, run it and
 * preview it. Reads only; changes nothing. The conventions behind each column: docs/environments.md.
 *
 *   node scripts/repo-readiness.ts           table of the repos cloned on this host
 *   node scripts/repo-readiness.ts --json    the same as JSON
 *
 * Each cell is `ok` (there), `--` (missing, optional or not chosen) or `!!` (missing in a way that
 * breaks a fresh environment); `n/a` where the column does not apply (no package.json).
 */
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLEET_DIR, type Os, type Repo, fleetPaths, loadRepos, readHostConfig, repoDir } from './config.ts';

export type Mark = 'ok' | '--' | '!!' | 'n/a';

export interface Cell {
  mark: Mark;
  /** What was found or what is missing, short. */
  note: string;
}

export interface Readiness {
  /** The repo's read-first file (fleet.json `readFirst`, else AGENTS.md or CLAUDE.md). */
  readFirst: Cell;
  /** `.agents/setup`, the executable script Amp orbs and Delta Cloud Runners run in a fresh checkout. */
  setup: Cell;
  /** A `dev` script in package.json. */
  dev: Cell;
  /** Pinned Node version and a known package manager. */
  runtime: Cell;
  /** `.env.example`: the names of the variables a fresh environment must be given. */
  env: Cell;
  /** Provider preview and run configs found: Amp services, Claude Code launch, T3 Code scripts. */
  previews: Cell;
}

export const COLUMNS: readonly (keyof Readiness)[] = ['readFirst', 'setup', 'dev', 'runtime', 'env', 'previews'];
const HEADINGS: Record<keyof Readiness, string> = {
  readFirst: 'read first',
  setup: '.agents/setup',
  dev: 'dev',
  runtime: 'runtime',
  env: 'env names',
  previews: 'previews',
};

const has = (dir: string, file: string) => existsSync(join(dir, file));
const isExecutable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

interface PackageJson {
  packageManager?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
}

const readPackage = (dir: string): PackageJson | null => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
};

const NODE_PINS = ['.node-version', '.nvmrc', 'mise.toml', '.mise.toml', '.tool-versions'];
const LOCKFILES: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];
const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.dist', '.env.template'];
const PREVIEW_CONFIGS: [string, string][] = [
  ['.amp/services.yaml', 'amp'],
  ['.claude/launch.json', 'claude'],
  ['t3.json', 't3'],
];

/** What the repo checked out at `dir` brings for a fresh environment. */
export function assessRepo(dir: string, readFirst?: string): Readiness {
  const pkg = readPackage(dir);

  const readFirstCell: Cell = readFirst
    ? has(dir, readFirst)
      ? { mark: 'ok', note: readFirst }
      : { mark: '!!', note: `${readFirst} missing` }
    : (['AGENTS.md', 'CLAUDE.md'].map((f) => (has(dir, f) ? { mark: 'ok' as const, note: f } : null)).find(Boolean) ?? { mark: '--', note: 'none' });

  const setupFile = join(dir, '.agents/setup');
  const setup: Cell = existsSync(setupFile)
    ? isExecutable(setupFile)
      ? { mark: 'ok', note: 'executable' }
      : { mark: '!!', note: 'not executable; chmod +x' }
    : { mark: '--', note: 'none' };

  const dev: Cell = !pkg ? { mark: 'n/a', note: '' } : pkg.scripts?.dev ? { mark: 'ok', note: 'dev' } : { mark: '--', note: 'no dev script' };

  let runtime: Cell = { mark: 'n/a', note: '' };
  if (pkg) {
    const pin = NODE_PINS.find((f) => has(dir, f)) ?? (pkg.engines?.node ? 'engines' : null);
    const lock = Object.keys(LOCKFILES).find((f) => has(dir, f));
    const manager = pkg.packageManager?.split('@')[0] ?? (lock ? LOCKFILES[lock] : null);
    const missing = [!pin && 'Node version', !manager && 'package manager'].filter(Boolean);
    runtime = missing.length
      ? { mark: '--', note: `no ${missing.join(', no ')}` }
      : { mark: 'ok', note: `${manager}, ${pin}` };
  }

  const example = ENV_EXAMPLES.find((f) => has(dir, f));
  const local = ENV_FILES.find((f) => has(dir, f));
  const env: Cell = example
    ? { mark: 'ok', note: example }
    : local
      ? { mark: '!!', note: `${local} here, names nowhere in Git` }
      : { mark: '--', note: 'none' };

  const found = PREVIEW_CONFIGS.filter(([file]) => has(dir, file)).map(([, label]) => label);
  const previews: Cell = found.length ? { mark: 'ok', note: found.join(', ') } : { mark: '--', note: 'none' };

  return { readFirst: readFirstCell, setup, dev, runtime, env, previews };
}

export interface Row {
  name: string;
  /** null: not cloned on this host (missing, or limited by `os` to another system). */
  readiness: Readiness | null;
  skipped?: string;
}

export function assessRepos(repos: readonly Repo[], dirOf: (repo: Repo) => string, os: Os | 'other'): Row[] {
  return repos.map((repo) => {
    if (repo.os && !(repo.os as string[]).includes(os)) return { name: repo.name, readiness: null, skipped: `only on ${repo.os.join(', ')}` };
    const dir = dirOf(repo);
    if (!existsSync(dir)) return { name: repo.name, readiness: null, skipped: 'not cloned; FLEET_CLONE=yes scripts/setup.sh' };
    return { name: repo.name, readiness: assessRepo(dir, repo.readFirst) };
  });
}

/** A plain-text table, one line per repo, `<mark> <note>` per cell. */
export function renderTable(rows: readonly Row[]): string {
  const cell = (c: Cell) => (c.mark === 'n/a' ? 'n/a' : `${c.mark} ${c.note}`);
  const header = ['repo', ...COLUMNS.map((c) => HEADINGS[c])];
  const assessed = rows.flatMap((r) => (r.readiness ? [[r.name, ...COLUMNS.map((c) => cell(r.readiness![c]))]] : []));
  // Skipped repos span the cells after the name, so only their name counts towards a width.
  const widths = header.map((h, i) => Math.max(h.length, ...assessed.map((cells) => cells[i].length), ...(i === 0 ? rows.map((r) => r.name.length) : [])));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), ...rows.map((r) => line(r.readiness ? [r.name, ...COLUMNS.map((c) => cell(r.readiness![c]))] : [r.name, `-- ${r.skipped}`]))].join('\n');
}

const thisOs = (): Os | 'other' => (process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'other');

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const host = readHostConfig(FLEET_DIR);
    if (!host) throw new Error('no fleet.local.json: run scripts/setup.sh first');
    const paths = fleetPaths(FLEET_DIR, host);
    if (!existsSync(paths.list)) throw new Error(`no repo list at ${paths.list}: run scripts/setup.sh`);
    const rows = assessRepos(loadRepos(paths.list), (repo) => repoDir(repo, host), thisOs());
    if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(renderTable(rows));
      console.log('\nok there  -- missing or optional  !! breaks a fresh environment  n/a no package.json. What each column means: docs/environments.md');
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
