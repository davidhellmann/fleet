import { CardLabel } from './CardLabel';

export interface KpiCardProps {
  label: string;
  value: string;
  /** Muted line under the value. */
  detail?: string;
  /** Change against the previous period, already formatted ("+12 %"); none without a base. */
  change?: string | null;
  /** The value is a name (repo, branch), not a number: smaller, and it may wrap. */
  name?: boolean;
}

/** A name with break opportunities after `.`, `-`, `_` and `/`, so `com.example.www` wraps at its parts. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[.\-_/])/);
  return parts.map((part, i) => <span key={i}>{part}{i < parts.length - 1 && <wbr />}</span>);
}

/**
 * One key figure. The change is neutral ink, not green or red: more usage is neither good nor bad.
 * A name as the value (`name`) is set smaller and wraps at its parts; it never leaves the card.
 */
export function KpiCard({ label, value, detail, change, name }: KpiCardProps) {
  return (
    <div data-slot="kpi" className="flex min-w-0 flex-col gap-2 rounded-lg bg-card p-5">
      <CardLabel>{label}</CardLabel>
      {name ? (
        <p className="text-xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
          <Breakable text={value} />
        </p>
      ) : (
        <p className="text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
      )}
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        {change && <span className="font-mono text-foreground">{change}<span className="sr-only"> against the previous period</span></span>}
        {change && <span aria-hidden="true">vs. previous</span>}
        {detail && <span>{detail}</span>}
      </p>
    </div>
  );
}
