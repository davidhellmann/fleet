/**
 * A repo's `stack` in fleet.json: short tags for what it is built on and what a host must bring to run
 * it, `name` or `name@version` (`craft@5`, `php@8.4`, `mysql@8.0`, `pnpm`). A tag named in HOST_TOOLS
 * is installed on the host; every other tag is context for agents and for filtering.
 *
 * - stackFromRepo: the tags a checkout's own files show (composer.json, package.json, pins, .env.example).
 * - compareStack: fleet.json against those files, the `stack` column of scripts/repo-readiness.ts.
 * - hostNeeds: what this host has of the host tools its repos name; run this file for the report.
 *
 *   node scripts/stack.ts          what this host needs for the repos' stacks, and what it has
 *   node scripts/stack.ts --json   the same as JSON
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLEET_DIR, type Os, type Repo, fleetPaths, loadRepos, readHostConfig } from './config.ts';
import type { Cell } from './repo-readiness.ts';

export interface Tag {
  name: string;
  version?: string;
}

export const parseTag = (tag: string): Tag => {
  const [name, version] = tag.split('@');
  return version ? { name, version } : { name };
};
export const formatTag = (t: Tag): string => (t.version ? `${t.name}@${t.version}` : t.name);

/** Two versions agree when they match on every part both name: `8.4` and `8.4.27`, `22` and `22.18.0`. */
export const versionsAgree = (a: string, b: string): boolean => {
  const [x, y] = [a.split('.'), b.split('.')];
  return x.slice(0, Math.min(x.length, y.length)).every((part, i) => part === y[i]);
};

/** `version` satisfies the tag's version: equal on every part the tag names (`8.4` wants 8.4.x). */
const satisfies = (wanted: string, version: string) => {
  const [w, v] = [wanted.split('.'), version.split('.')];
  return w.every((part, i) => part === v[i]);
};

interface HostTool {
  /** The command on PATH, run with `args` to print its version. */
  command: string;
  args: string[];
  /** Homebrew formula when it differs from the tag (`postgresql` for `postgres`). */
  formula?: string;
  /** A server that may run outside PATH (DBngin, Docker, another machine): missing is not an error. */
  service?: boolean;
  /** The only system it installs on; a repo that runs elsewhere too does not need it there. */
  os?: Os;
}

/** The tags a host installs. Other tags (frameworks) come with the repo's own dependencies. */
export const HOST_TOOLS: Record<string, HostTool> = {
  php: { command: 'php', args: ['-r', 'echo PHP_VERSION;'] },
  composer: { command: 'composer', args: ['--version'] },
  node: { command: 'node', args: ['--version'] },
  pnpm: { command: 'pnpm', args: ['--version'] },
  yarn: { command: 'yarn', args: ['--version'] },
  bun: { command: 'bun', args: ['--version'] },
  mysql: { command: 'mysql', args: ['--version'], service: true },
  mariadb: { command: 'mariadb', args: ['--version'], service: true },
  postgres: { command: 'psql', args: ['--version'], formula: 'postgresql', service: true },
  redis: { command: 'redis-server', args: ['--version'], service: true },
  xcode: { command: 'xcodebuild', args: ['-version'], os: 'macos' },
};

// --- What a checkout shows ---------------------------------------------------------------------

/** Frameworks found by their package: the tag, the manager and the package name. */
const FRAMEWORKS: [tag: string, manager: 'composer' | 'npm', pkg: string][] = [
  ['craft', 'composer', 'craftcms/cms'],
  ['laravel', 'composer', 'laravel/framework'],
  ['astro', 'npm', 'astro'],
  ['sveltekit', 'npm', '@sveltejs/kit'],
  ['next', 'npm', 'next'],
  ['nuxt', 'npm', 'nuxt'],
];
const LOCKFILES: [file: string, manager: string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const DATABASES: Record<string, string> = { mysql: 'mysql', mariadb: 'mariadb', pgsql: 'postgres', postgres: 'postgres', postgresql: 'postgres' };

export interface Found extends Tag {
  /** The file the tag was read from. */
  from: string;
}

const readJson = (file: string): Record<string, any> | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (file: string): string | null => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** The major of an exact or caret/tilde version (`^5.12.1` → 5); null for ranges such as `>=8.2`. */
const majorOf = (spec: unknown): string | null => (typeof spec === 'string' ? (/^[\^~=v]?\s*(\d+)(\.|$)/.exec(spec.trim())?.[1] ?? null) : null);
/** The first version in a text (`v22.18.0`, `php=php@8.4`, `8.2.0`), cut to `parts` parts. */
const versionIn = (text: string | null | undefined, parts: number): string | null => {
  const m = /(\d+(?:\.\d+)*)/.exec(text ?? '');
  return m ? m[1].split('.').slice(0, parts).join('.') : null;
};

/** The tags the files of the checkout at `dir` show, with versions cut to what a host installs. */
export function stackFromRepo(dir: string): Found[] {
  const found: Found[] = [];
  const add = (name: string, version: string | null, from: string) => {
    if (!found.some((t) => t.name === name)) found.push(version ? { name, version, from } : { name, from });
  };

  const composer = readJson(join(dir, 'composer.json'));
  if (composer) {
    const platform = composer.config?.platform?.php;
    const valet = readText(join(dir, '.valetrc'))?.match(/^php=(.+)$/m)?.[1];
    if (platform) add('php', versionIn(platform, 2), 'composer.json');
    else add('php', versionIn(valet, 2), valet ? '.valetrc' : 'composer.json');
    add('composer', null, 'composer.json');
  }

  const pkg = readJson(join(dir, 'package.json'));
  if (pkg) {
    const pin = ['.node-version', '.nvmrc'].find((f) => existsSync(join(dir, f)));
    add('node', pin ? versionIn(readText(join(dir, pin)), 1) : null, pin ?? 'package.json');
    const manager = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : LOCKFILES.find(([f]) => existsSync(join(dir, f)))?.[1];
    // npm comes with Node, so it is no tag of its own.
    if (manager && manager !== 'npm') add(manager, null, typeof pkg.packageManager === 'string' ? 'package.json' : 'lockfile');
  }

  const deps = { npm: { ...pkg?.dependencies, ...pkg?.devDependencies }, composer: { ...composer?.require, ...composer?.['require-dev'] } };
  for (const [tag, manager, name] of FRAMEWORKS) {
    if (name in deps[manager]) add(tag, majorOf(deps[manager][name]), manager === 'npm' ? 'package.json' : 'composer.json');
  }

  const env = readText(join(dir, '.env.example'));
  const driver = env?.match(/^(?:CRAFT_)?DB_(?:DRIVER|CONNECTION)=["']?(\w+)/m)?.[1]?.toLowerCase();
  if (driver && DATABASES[driver]) add(DATABASES[driver], null, '.env.example');
  if (env && /^REDIS_/m.test(env)) add('redis', null, '.env.example');

  try {
    if (readdirSync(dir).some((f) => f.endsWith('.xcodeproj'))) add('xcode', null, '*.xcodeproj');
  } catch {
    /* not readable: nothing to add */
  }
  return found;
}

/** The `stack` cell of the readiness report: fleet.json's tags against what the checkout shows. */
export function compareStack(stack: readonly string[] | undefined, found: readonly Found[]): Cell {
  const tags = (stack ?? []).map(parseTag);
  const conflicts = found.flatMap((f) => {
    const t = tags.find((tag) => tag.name === f.name);
    return t?.version && f.version && !versionsAgree(t.version, f.version) ? [`${formatTag(t)} but ${f.from} says ${f.version}`] : [];
  });
  if (conflicts.length) return { mark: '!!', note: conflicts.join('; ') };
  const missing = found.filter((f) => !tags.some((t) => t.name === f.name));
  if (missing.length) return { mark: '--', note: `add ${missing.map(formatTag).join(', ')}` };
  return tags.length ? { mark: 'ok', note: tags.map(formatTag).join(', ') } : { mark: '--', note: 'none' };
}

// --- What a host has ---------------------------------------------------------------------------

/** Runs a command and returns what it printed; null when it is missing or fails. */
export type Probe = (command: string, args: string[]) => string | null;

const run: Probe = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  } catch {
    return null;
  }
};

/** Node versions nvm installed, newest last: `<NVM_DIR>/versions/node/v22.18.0/bin/node`. */
const nvmNodes = (): string[] => {
  const dir = join(process.env.NVM_DIR ?? join(homedir(), '.nvm'), 'versions/node');
  try {
    return readdirSync(dir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((v) => join(dir, v, 'bin/node'));
  } catch {
    return [];
  }
};

/** Where a version installed beside the active one lives: `php8.2` on Debian/Ubuntu, Homebrew's `opt/<formula>@<v>`, nvm. */
const sideBySide = (name: string, tool: HostTool, version: string): string[] => [
  `${tool.command}${version}`,
  ...['/opt/homebrew', '/usr/local'].map((prefix) => `${prefix}/opt/${tool.formula ?? name}@${version}/bin/${tool.command}`),
  ...(name === 'node' ? nvmNodes().filter((path) => path.includes(`/v${version}.`)).reverse() : []),
];

export interface Need {
  /** The tag as the repos name it, `php@8.4` or `pnpm`. */
  tag: string;
  repos: string[];
  /** ok: there; `!!` missing or the wrong version; `--` a service not on PATH. */
  cell: Cell;
}

/** Every host tool the repos allowed on `os` name, one entry per tag, and whether this host has it. */
export function hostNeeds(repos: readonly Repo[], os: Os | 'other', probe: Probe = run): Need[] {
  const byTag = new Map<string, string[]>();
  for (const repo of repos) {
    if (repo.os && !(repo.os as string[]).includes(os)) continue;
    for (const tag of repo.stack ?? []) {
      const tool = HOST_TOOLS[parseTag(tag).name];
      if (tool && (!tool.os || tool.os === os)) byTag.set(tag, [...(byTag.get(tag) ?? []), repo.name]);
    }
  }
  const versionOf = (command: string, tool: HostTool) => versionIn(probe(command, tool.args), 3);

  return [...byTag].sort(([a], [b]) => a.localeCompare(b)).map(([tag, names]) => {
    const { name, version: wanted } = parseTag(tag);
    const tool = HOST_TOOLS[name];
    const active = versionOf(tool.command, tool);
    let cell: Cell;
    if (!active && tool.service) cell = { mark: '--', note: `${tool.command} not on PATH; fine when it runs elsewhere (DBngin, Docker, a server)` };
    else if (!active) cell = { mark: '!!', note: `${tool.command} missing` };
    else if (!wanted || satisfies(wanted, active)) cell = { mark: 'ok', note: `${active} (${tool.command})` };
    else {
      const beside = sideBySide(name, tool, wanted)
        .map((command) => ({ command, version: versionOf(command, tool) }))
        .find((c) => c.version && satisfies(wanted, c.version));
      cell = beside ? { mark: 'ok', note: `${beside.version} (${beside.command}; active ${active})` } : { mark: '!!', note: `active ${active}, no ${wanted} beside it` };
    }
    return { tag, repos: names, cell };
  });
}

export function renderNeeds(needs: readonly Need[]): string {
  const rows = [['tool', 'this host', 'repos'], ...needs.map((n) => [n.tag, `${n.cell.mark} ${n.cell.note}`, n.repos.join(', ')])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const thisOs = (): Os | 'other' => (process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'other');

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const paths = fleetPaths(FLEET_DIR, readHostConfig(FLEET_DIR));
    if (!existsSync(paths.list)) throw new Error(`no repo list at ${paths.list}: run scripts/setup.sh`);
    const needs = hostNeeds(loadRepos(paths.list), thisOs());
    if (process.argv.includes('--json')) console.log(JSON.stringify(needs, null, 2));
    else if (!needs.length) console.log('No repo names a host tool in its "stack" (fleet.json).');
    else {
      console.log(renderNeeds(needs));
      console.log('\nok there  !! missing or another version  -- a service not on PATH. Installing them: docs/environments.md#host-tools');
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
