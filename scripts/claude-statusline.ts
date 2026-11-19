/**
 * Claude Code status line hook for the fleet dashboard: records the plan limits Claude Code passes
 * to the status line (`rate_limits`), then runs the status line command already in use and prints
 * its output, so the status line looks as before.
 *
 * In ~/.claude/settings.json, put this in front of the existing command:
 *
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node /path/to/fleet/scripts/claude-statusline.ts pnpm dlx ccusage statusline"
 *   }
 *
 * Every change is appended to .cache/claude-limits.jsonl as { at, rate_limits }; unchanged values
 * are not written again. Nothing here may break the status line: errors are ignored, and the chained
 * command always runs. Runs on Node's type stripping (22.18+).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = fileURLToPath(new URL('../.cache/', import.meta.url));
const LOG = join(CACHE, 'claude-limits.jsonl');
const LAST = join(CACHE, 'claude-limits.last');

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {}

try {
  const limits = JSON.parse(input)?.rate_limits;
  if (limits && typeof limits === 'object') {
    const value = JSON.stringify(limits);
    const last = existsSync(LAST) ? readFileSync(LAST, 'utf8') : '';
    if (value !== last) {
      mkdirSync(CACHE, { recursive: true });
      appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), rate_limits: limits })}\n`);
      writeFileSync(LAST, value);
    }
  }
} catch {}

// The status line command in use, with the same input
const [command, ...args] = process.argv.slice(2);
if (command) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  if (result.stdout) process.stdout.write(result.stdout);
  process.exitCode = result.status ?? 0;
}
