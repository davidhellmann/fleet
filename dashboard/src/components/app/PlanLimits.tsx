import { CardLabel } from './CardLabel';
import { formatAgo, formatIn } from '@/lib/format.ts';
import type { PlanLimits as Limits } from '../../../collect/limits.ts';

const APP: Record<string, string> = { 'claude-code': 'Claude', codex: 'Codex', amp: 'Amp' };

/** Bar colour: the accent, amber from 80 %, red from 95 % (the number always says it too). */
const fill = (used: number) => (used >= 95 ? 'bg-negative' : used >= 80 ? 'bg-warning' : 'bg-brand');

function AppLimits({ name, limits, missing }: { name: string; limits: Limits | null; missing: string }) {
  if (!limits) {
    return (
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{name}</h3>
        <p className="text-xs text-muted-foreground">{missing}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{name}{limits.plan && <span className="ml-2 font-mono text-xs text-muted-foreground">{limits.plan}</span>}</h3>
        <span className="text-xs text-muted-foreground">as of {formatAgo(limits.at)}</span>
      </div>
      {limits.windows.map((w) => {
        // A window that has reset since the reading no longer holds that usage
        const reset = w.resetsAt !== null && Date.parse(w.resetsAt) <= Date.now();
        const used = Math.min(100, Math.max(0, w.usedPercent));
        return (
          <div key={w.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-mono uppercase tracking-[0.08em] text-muted-foreground">{w.label}</span>
              {reset
                ? <span className="text-muted-foreground">reset since (was {Math.round(used)} %)</span>
                : <span><span className="font-medium">{Math.round(used)} %</span> used{w.resetsAt && <span className="text-muted-foreground"> · resets {formatIn(w.resetsAt)}</span>}</span>}
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${reset ? 'bg-muted-foreground/40' : fill(used)}`} style={{ width: `${used}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How much of each plan window is used, per app, and when it resets. */
export function PlanLimits({ claude, codex, amp }: { claude: Limits | null; codex: Limits | null; amp?: Limits | null }) {
  return (
    <section data-slot="plan-limits" className="flex flex-col gap-4 rounded-lg bg-card p-5">
      <CardLabel as="h2">Plan limits</CardLabel>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <AppLimits name={APP['claude-code']} limits={claude} missing="Not recorded yet: put scripts/claude-statusline.ts in front of the status line command (README, Plan limits)." />
        <AppLimits name={APP.codex} limits={codex} missing="No limits in the Codex logs yet; they come with pnpm collect." />
        <AppLimits name={APP.amp} limits={amp ?? null} missing={'Not read yet: set "amp": true in fleet.local.json on one host and run pnpm collect.'} />
      </div>
    </section>
  );
}
