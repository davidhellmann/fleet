import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, SIDEBAR_STORAGE_KEY,
} from '@/components/ui/sidebar';
import { withPeriod, type Period } from '@/lib/period.ts';
import { ThemeMenu } from './ThemeMenu';
import { CollectState } from './CollectState';
import type { CollectStatus } from '../../../collect/run.ts';
import { NAV, type NavKey } from './nav';

// Runs while the HTML is parsed, right after the sidebar element: applies a stored "collapsed"
// before the first paint, so the server's expanded HTML never flashes. React adopts it after hydration.
const RESTORE_COLLAPSED = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==='false'){var s=document.currentScript.previousElementSibling;s.setAttribute('data-state','collapsed');s.setAttribute('data-collapsible','icon')}}catch(e){}`;

export interface AppSidebarProps {
  active: NavKey;
  /** Current period; every link keeps it. */
  period: Period;
  /** Name of this host (fleet.local.json); none before setup has run. */
  host?: string;
  /** The collector's state when the page was rendered; none hides the footer line. */
  collect?: CollectStatus;
  /** This page with its query, where the refresh button returns to. */
  back?: string;
}

/** fleet's mark: an "f" on the accent, for the collapsed sidebar and next to the name. */
function Mark() {
  return (
    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-sm bg-brand font-mono text-sm font-semibold text-brand-foreground">
      f
    </span>
  );
}

export function AppSidebar({ active, period, host, collect, back = '/' }: AppSidebarProps) {
  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" className="hover:bg-transparent active:bg-transparent">
                <a href={withPeriod('/', period)} aria-label="fleet, overview">
                  <Mark />
                  <span className="font-mono text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">fleet</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Main navigation">
            <SidebarGroup>
              <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase">Dashboard</SidebarGroupLabel>
              <SidebarMenu>
                {NAV.map(({ key, label, href, icon: Icon }) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton asChild isActive={key === active} tooltip={label}>
                      <a href={withPeriod(href, period)} aria-current={key === active ? 'page' : undefined}>
                        <Icon />
                        <span>{label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <ThemeMenu />
            </SidebarMenuItem>
          </SidebarMenu>
          {collect && <CollectState initial={collect} back={back} />}
          {host && (
            <p className="px-2 pb-1 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">
              Host · {host}
            </p>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <script dangerouslySetInnerHTML={{ __html: RESTORE_COLLAPSED }} />
    </>
  );
}
