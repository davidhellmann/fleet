import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { readThemePreference, setThemePreference, systemScheme, watchTheme, type Scheme, type ThemePreference } from '@/lib/theme.ts';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const PREFS: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * System / light / dark for the sidebar footer: a menu the user opens on purpose, so all three
 * states are offered; system names the scheme it currently resolves to.
 */
export function ThemeMenu() {
  // The server renders the default; the stored choice is read after hydration.
  const [pref, setPref] = React.useState<ThemePreference>('system');
  const [system, setSystem] = React.useState<Scheme>('light');
  React.useEffect(() => {
    const sync = () => {
      setPref(readThemePreference());
      setSystem(systemScheme());
    };
    sync();
    return watchTheme(sync);
  }, []);

  const Icon = ICONS[pref];
  const choose = (v: string) => {
    const next = v as ThemePreference;
    setPref(next);
    setThemePreference(next);
  };
  const label = (p: ThemePreference) => (p === 'system' ? `System (${system})` : LABELS[p]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Theme">
          <Icon />
          <span>Theme</span>
          <span className="ml-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{label(pref)}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={pref} onValueChange={choose}>
          {PREFS.map((p) => {
            const I = ICONS[p];
            return (
              <DropdownMenuRadioItem key={p} value={p}>
                <I />
                {label(p)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
