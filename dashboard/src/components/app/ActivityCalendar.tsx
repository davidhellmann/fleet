import { cn } from 'cn';
import { formatDay, formatTokens, formatUsd } from '@/lib/format.ts';
import type { ActivityCell } from '@/lib/usage.ts';

const LEVEL = ['bg-level-0', 'bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4'] as const;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

const describe = (c: ActivityCell) =>
  c.tokens === 0
    ? `${formatDay(c.day)}: no agent activity`
    : `${formatDay(c.day)}: ${formatUsd(c.cost)}, ${formatTokens(c.tokens)} tokens, ${c.sessions} session${c.sessions === 1 ? '' : 's'}`;

/**
 * GitHub-style calendar of agent activity: one column per week (Monday on top), one square per
 * day, shaded by the day's cost. Server-rendered, no script; each day names its figures as
 * tooltip and accessible name. Days after today stay empty.
 */
export function ActivityCalendar({ cells, label }: { cells: (ActivityCell | null)[]; label: string }) {
  const weeks = Math.ceil(cells.length / 7);
  // Month label above the first week that starts in a new month
  const months: { week: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const first = cells[w * 7];
    if (!first) continue;
    const m = first.day.slice(0, 7);
    const prev = w > 0 ? cells[(w - 1) * 7]?.day.slice(0, 7) : null;
    if (m !== prev) months.push({ week: w, label: MONTH.format(new Date(`${first.day}T00:00:00Z`)) });
  }
  const grid = { gridTemplateColumns: `auto repeat(${weeks}, minmax(0, 1fr))` };

  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[42rem] gap-[3px] font-mono text-[10px] text-muted-foreground" style={grid} role="img" aria-label={label}>
          <span />
          {Array.from({ length: weeks }, (_, w) => (
            <span key={w} className="h-4 overflow-visible whitespace-nowrap">{months.find((m) => m.week === w)?.label ?? ''}</span>
          ))}
          {WEEKDAYS.map((name, d) => (
            <div key={d} className="contents">
              <span className="pr-2 leading-none">{name}</span>
              {Array.from({ length: weeks }, (_, w) => {
                const c = cells[w * 7 + d];
                return c ? (
                  <span key={w} title={describe(c)} className={cn('aspect-square rounded-[3px]', LEVEL[c.level])} />
                ) : (
                  <span key={w} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="flex items-center justify-end gap-1.5 font-mono text-[10px] text-muted-foreground">
        <span>Less</span>
        {LEVEL.map((cls) => <span key={cls} aria-hidden="true" className={cn('size-2.5 rounded-[2px]', cls)} />)}
        <span>More</span>
      </figcaption>
    </figure>
  );
}
