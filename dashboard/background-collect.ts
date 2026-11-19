/**
 * Astro integration: while the dashboard's server runs, start the collector every `collectMinutes`
 * (fleet.local.json, default 15; 0 = off). `pnpm dashboard` already collects once before the server
 * starts, so the first background run comes one interval later. Runs never overlap (collector lock).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AstroIntegration } from 'astro';
import { loadHostConfig } from '../scripts/config.ts';
import { startCollector } from './collect/run.ts';

export function backgroundCollect(fleetDir: string): AstroIntegration {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    name: 'fleet:background-collect',
    hooks: {
      'astro:server:start': ({ logger }) => {
        const local = join(fleetDir, 'fleet.local.json');
        const minutes = existsSync(local) ? loadHostConfig(local).collectMinutes : 0;
        if (minutes <= 0) {
          logger.info('background collection off (collectMinutes in fleet.local.json)');
          return;
        }
        timer = setInterval(() => {
          const result = startCollector(fleetDir);
          logger.info(result === 'started' ? 'collecting in the background' : 'collector already running; skipped');
        }, minutes * 60_000);
        timer.unref();
        logger.info(`collecting every ${minutes} min while the dashboard runs`);
      },
      'astro:server:done': () => {
        if (timer) clearInterval(timer);
        timer = null;
      },
    },
  };
}
