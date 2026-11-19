/** Session log files of the readers. */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under `dir` (recursively) whose name ends with `suffix`; nothing when `dir` is missing. */
export function* filesUnder(dir: string, suffix: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* filesUnder(path, suffix);
    else if (e.isFile() && e.name.endsWith(suffix)) yield path;
  }
}
