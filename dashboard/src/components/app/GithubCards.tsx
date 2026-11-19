import { CardLabel } from './CardLabel';
import { EmptyState } from './EmptyState';
import { formatAgo } from '@/lib/format.ts';
import { SEVERITIES, type Alert, type Issue, type RepoGithub, type Severity } from '../../../collect/github.ts';

/** Severity as text, coloured by weight (critical and high red, medium amber, low muted). */
export function SeverityTag({ severity }: { severity: Severity }) {
  const tone = severity === 'critical' || severity === 'high' ? 'text-negative' : severity === 'medium' ? 'text-warning' : 'text-muted-foreground';
  return <span className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${tone}`}>{severity}</span>;
}

const countBy = (alerts: Alert[]) => SEVERITIES.map((s) => [s, alerts.filter((a) => a.severity === s).length] as const).filter(([, n]) => n > 0);

/** Overview: open Dependabot alerts per repo, most severe repos first. */
export function SecurityCard({ repos, at, hrefOf }: { repos: Record<string, RepoGithub>; at: string | null; hrefOf: (repo: string) => string }) {
  const rank = (alerts: Alert[]) => SEVERITIES.map((s) => alerts.filter((a) => a.severity === s).length);
  const withAlerts = Object.entries(repos)
    .filter(([, g]) => g.alerts?.length)
    .sort(([, a], [, b]) => {
      const ra = rank(a.alerts!), rb = rank(b.alerts!);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
      return 0;
    });
  const off = Object.entries(repos).filter(([, g]) => g.alertsError);
  const total = withAlerts.reduce((a, [, g]) => a + g.alerts!.length, 0);
  return (
    <section data-slot="security" className="flex flex-col gap-4 rounded-lg bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardLabel as="h2">Security</CardLabel>
        {at && <p className="font-mono text-xs text-muted-foreground">{total} open alert{total === 1 ? '' : 's'} · as of {formatAgo(at)}</p>}
      </div>
      {!at ? (
        <EmptyState>No GitHub data yet: run pnpm collect.</EmptyState>
      ) : withAlerts.length === 0 ? (
        <EmptyState>No open Dependabot alerts.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5 text-xs">
          {withAlerts.map(([repo, g]) => (
            <li key={repo} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <a className="min-w-0 flex-1 font-mono hover:underline [overflow-wrap:anywhere]" href={hrefOf(repo)}>{repo}</a>
              <span className="flex gap-2">{countBy(g.alerts!).map(([s, n]) => <span key={s}>{n} <SeverityTag severity={s} /></span>)}</span>
            </li>
          ))}
        </ul>
      )}
      {off.length > 0 && <p className="text-xs text-muted-foreground" title={off.map(([r, g]) => `${r}: ${g.alertsError}`).join('\n')}>Alerts not readable for {off.length} repo{off.length === 1 ? '' : 's'}: {[...new Set(off.map(([, g]) => g.alertsError))].join('; ')}.</p>}
    </section>
  );
}

/** One issue line: number, title, labels, age. */
function IssueLine({ issue, repo, repoHref }: { issue: Issue; repo?: string; repoHref?: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <a className="hover:underline" href={issue.url}><span className="font-mono text-muted-foreground">#{issue.number}</span> {issue.title}</a>
      <span className="flex flex-wrap gap-x-2 text-muted-foreground">
        {repo && (repoHref ? <a className="font-mono hover:underline" href={repoHref}>{repo}</a> : <span className="font-mono">{repo}</span>)}
        {issue.labels.map((l) => <span key={l} className="rounded-sm bg-muted px-1">{l}</span>)}
        <span>updated {formatAgo(issue.updatedAt)}</span>
      </span>
    </li>
  );
}

/** Overview: the open issues assigned to the signed-in user, across every repo. */
export function AssignedIssuesCard({ repos, viewer, at, hrefOf }: { repos: Record<string, RepoGithub>; viewer: string | null; at: string | null; hrefOf: (repo: string) => string }) {
  const mine = viewer
    ? Object.entries(repos).flatMap(([repo, g]) => (g.issues ?? []).filter((i) => i.assignees.includes(viewer)).map((issue) => ({ repo, issue })))
    : [];
  mine.sort((a, b) => b.issue.updatedAt.localeCompare(a.issue.updatedAt));
  const open = Object.values(repos).reduce((a, g) => a + (g.issues?.length ?? 0), 0);
  return (
    <section data-slot="assigned-issues" className="flex flex-col gap-4 rounded-lg bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardLabel as="h2">Assigned to you</CardLabel>
        {at && <p className="font-mono text-xs text-muted-foreground">{open} open issues in all repos</p>}
      </div>
      {!at ? (
        <EmptyState>No GitHub data yet: run pnpm collect.</EmptyState>
      ) : !viewer ? (
        <EmptyState>gh did not say who is signed in.</EmptyState>
      ) : mine.length === 0 ? (
        <EmptyState>No open issues assigned to {viewer}.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3 text-xs">{mine.slice(0, 12).map(({ repo, issue }) => <IssueLine key={`${repo}#${issue.number}`} issue={issue} repo={repo} repoHref={hrefOf(repo)} />)}</ul>
      )}
    </section>
  );
}

/** "Issues are off for this repo." for a switched-off feature; "Not read: …" for real failures. */
const why = (error: string) => (/are off/.test(error) ? `${error[0].toUpperCase()}${error.slice(1)}.` : `Not read: ${error}.`);

/** Project page: the repo's open issues and Dependabot alerts side by side. */
export function RepoIssuesAndAlerts({ data }: { data: RepoGithub | undefined }) {
  if (!data) return <EmptyState>No GitHub data for this repo yet: run pnpm collect.</EmptyState>;
  const issues = data.issues ?? [];
  const alerts = data.alerts ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Open issues <span className="text-muted-foreground">{issues.length}</span></h3>
        {data.issuesError ? <p className="text-xs text-muted-foreground">{why(data.issuesError)}</p>
          : issues.length === 0 ? <p className="text-xs text-muted-foreground">None.</p>
          : <ul className="flex flex-col gap-3 text-xs">{issues.slice(0, 15).map((i) => <IssueLine key={i.number} issue={i} />)}</ul>}
        {issues.length > 15 && <p className="text-xs text-muted-foreground">{issues.length - 15} more on GitHub.</p>}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Dependabot alerts <span className="text-muted-foreground">{alerts.length}</span></h3>
        {data.alertsError ? <p className="text-xs text-muted-foreground">{why(data.alertsError)}</p>
          : alerts.length === 0 ? <p className="text-xs text-muted-foreground">None open.</p>
          : (
            <ul className="flex flex-col gap-3 text-xs">
              {alerts.slice(0, 15).map((a) => (
                <li key={a.number} className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <SeverityTag severity={a.severity} />
                    <a className="font-mono hover:underline" href={a.url}>{a.package}</a>
                    <span className="text-muted-foreground">{a.ecosystem}</span>
                  </span>
                  <span className="text-muted-foreground">{a.summary}{a.fixedIn ? ` · fixed in ${a.fixedIn}` : ' · no fix yet'}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
