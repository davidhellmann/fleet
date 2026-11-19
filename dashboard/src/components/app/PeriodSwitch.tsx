import { cn } from 'cn';
import { PERIODS, PERIOD_LABELS, PERIOD_NAMES, withPeriod, type Period } from '@/lib/period.ts';

/**
 * The period switch in the page header: plain links to the same page with `?period=`, so it needs no
 * script and every period has a URL. The current one carries aria-current and an inverted fill (not
 * colour alone).
 */
export function PeriodSwitch({ period, path }: { period: Period; path: string }) {
  return (
    <nav aria-label="Period" className="rounded-md bg-muted p-0.5" data-slot="period-switch">
      <ul className="flex items-center">
        {PERIODS.map((p) => (
          <li key={p}>
            <a
              href={withPeriod(path, p)}
              aria-current={p === period ? 'page' : undefined}
              aria-label={PERIOD_NAMES[p]}
              className={cn(
                'flex h-7 items-center rounded-sm px-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground',
                'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                'aria-[current=page]:bg-primary aria-[current=page]:font-medium aria-[current=page]:text-primary-foreground',
                'forced-colors:aria-[current=page]:outline forced-colors:aria-[current=page]:outline-1',
              )}
            >
              {PERIOD_LABELS[p]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
