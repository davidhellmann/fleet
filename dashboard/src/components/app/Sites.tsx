import { CardLabel } from './CardLabel';
import { EmptyState } from './EmptyState';
import { formatAgo } from '@/lib/format.ts';
import type { SiteCheck } from '../../../collect/sites.ts';

const DAY = 86_400_000;

/** Days until the certificate expires; negative once it has. */
export const certDays = (iso: string, now = Date.now()) => Math.floor((Date.parse(iso) - now) / DAY);

/** "cert 61 d", amber under three weeks, red once expired. Text carries it; colour repeats it. */
export function CertNote({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const d = certDays(iso);
  const tone = d < 0 ? 'text-negative' : d < 21 ? 'text-warning' : 'text-muted-foreground';
  return <span className={tone}>{d < 0 ? 'cert expired' : `cert ${d} d`}</span>;
}

/** One line: up or down, with status and time. */
export function SiteState({ check }: { check: SiteCheck }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${check.ok ? 'bg-positive' : 'bg-negative'}`} />
      {check.ok ? `up · ${check.status} · ${check.ms} ms` : `down · ${check.error}`}
    </span>
  );
}

/** Reachability of every site in fleet.json, as of the last collector run. */
export function Sites({ checks, at }: { checks: SiteCheck[]; at: string | null }) {
  const down = checks.filter((c) => !c.ok).length;
  return (
    <section data-slot="sites" className="flex flex-col gap-4 rounded-lg bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardLabel as="h2">Sites</CardLabel>
        {at && <p className="font-mono text-xs text-muted-foreground">{down ? `${down} down` : 'all up'} · as of {formatAgo(at)}</p>}
      </div>
      {checks.length === 0 ? (
        <EmptyState>No site checks yet: pnpm collect checks the sites in fleet.json.</EmptyState>
      ) : (
        <ul className="grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
          {checks.map((c) => (
            <li key={c.url} className="flex min-w-0 flex-col gap-0.5">
              <a className="truncate font-mono hover:underline" href={c.url}>{c.url.replace(/^https?:\/\//, '')}</a>
              <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                <SiteState check={c} />
                <CertNote iso={c.certExpires} />
              </span>
              {c.finalUrl && <span className="truncate text-muted-foreground">→ {c.finalUrl.replace(/^https?:\/\//, '')}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
