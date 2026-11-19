// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { backgroundCollect } from './background-collect.ts';

// The fleet repo (one up from dashboard/): where fleet.json and fleet.local.json live. Resolved here,
// because bundled server code cannot find them relative to its own location.
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  // Local only: `pnpm dashboard` runs `astro dev`. Pages render on every request, so a reload shows
  // fresh data and the period in the URL (?period=) is read on the server.
  output: 'server',
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
  // React islands only where the page reacts to input (sidebar, theme menu, charts); the collector
  // runs in the background while the server is up
  integrations: [react(), backgroundCollect(FLEET_DIR)],
  // Geist for UI and numbers, Geist Mono for labels; served locally through the Astro Fonts API
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Geist', cssVariable: '--font-geist', weights: ['100 900'], styles: ['normal'], subsets: ['latin', 'latin-ext'], fallbacks: ['sans-serif'] },
    { provider: fontProviders.fontsource(), name: 'Geist Mono', cssVariable: '--font-geist-mono', weights: ['100 900'], styles: ['normal'], subsets: ['latin', 'latin-ext'], fallbacks: ['monospace'] },
  ],
  vite: {
    plugins: [tailwindcss()],
    define: { __FLEET_DIR__: JSON.stringify(FLEET_DIR) },
  },
});
