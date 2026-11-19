/**
 * Theme: system (default), light or dark. The choice lives in <meta name="color-scheme">: "light dark"
 * follows the system, "light" or "dark" pin it; app.css maps the meta tag to `color-scheme`, and every
 * colour token is a light-dark() pair. An override is stored under THEME_KEY; system removes the
 * entry. The inline script in Base.astro applies a stored override before the first paint.
 */

export const THEME_KEY = 'fleet_theme';
export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** The scheme the system asks for right now. */
export const systemScheme = (): Scheme => (dark().matches ? 'dark' : 'light');

/** Puts a preference on the meta tag; the CSS follows. */
export function applyTheme(pref: ThemePreference) {
  const m = meta();
  if (m) m.content = pref === 'system' ? 'light dark' : pref;
}

/** Stores a preference (system: removes the entry) and applies it; applies it even if storage fails. */
export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {}
  applyTheme(pref);
}

/**
 * Calls `onChange` when the system scheme changes or another tab changes the preference (and applies
 * that preference here). Returns an unsubscribe function.
 */
export function watchTheme(onChange: () => void) {
  const mq = dark();
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    applyTheme(readThemePreference());
    onChange();
  };
  mq.addEventListener('change', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener('storage', onStorage);
  };
}
