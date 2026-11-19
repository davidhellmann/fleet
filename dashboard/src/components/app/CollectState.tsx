import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { formatAgo } from '@/lib/format.ts';
import type { CollectStatus } from '../../../collect/run.ts';

/** Seconds between status checks: often right after the page loads (a refresh may just have started), then calmly. */
const pollEvery = (msSinceMount: number) => (msSinceMount < 60_000 ? 5_000 : 30_000);

/**
 * The collector in the sidebar footer: when it last ran, whether it runs now, a refresh button (a
 * plain form, works without script) and, once newer data exists than this page shows, a reload link.
 * The page never reloads by itself, so nothing jumps while reading.
 */
export function CollectState({ initial, back }: { initial: CollectStatus; back: string }) {
  const [status, setStatus] = React.useState(initial);
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    const mounted = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch('/api/collect', { cache: 'no-store' });
        if (res.ok) setStatus(await res.json());
      } catch {}
      tick((n) => n + 1);
      timer = setTimeout(poll, pollEvery(Date.now() - mounted));
    };
    timer = setTimeout(poll, pollEvery(0));
    return () => clearTimeout(timer);
  }, []);

  const newer = status.at !== null && (initial.at === null || status.at > initial.at);
  const line = status.running
    ? 'Collecting…'
    : !status.ok
      ? `Last run failed${status.error ? `: ${status.error}` : ''}`
      : status.at
        ? `Collected ${formatAgo(status.at)}`
        : 'Not collected yet';

  return (
    <div data-slot="collect-state" className="flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground">
      <form method="post" action="/api/collect" className="contents">
        <input type="hidden" name="back" value={back} />
        <button
          type="submit"
          disabled={status.running}
          title="Collect now"
          aria-label="Collect now"
          className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${status.running ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
        </button>
      </form>
      <span className="min-w-0 group-data-[collapsible=icon]:hidden" role="status" aria-live="polite">
        <span className={!status.ok && !status.running ? 'text-negative' : undefined}>{line}</span>
        {newer && !status.running && (
          <>
            {' · '}
            <a href={back} className="text-foreground underline underline-offset-2">Reload</a>
          </>
        )}
      </span>
    </div>
  );
}
