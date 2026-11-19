/**
 * The collector from the browser. GET: its state (for the sidebar, polled). POST (the refresh
 * button, a plain form): start a run in the background and go back to the page. Astro's origin
 * check refuses form posts from other sites.
 */
import type { APIRoute } from 'astro';
import { collectStatus, startCollector } from '../../../collect/run.ts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(collectStatus(__FLEET_DIR__)), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Only a path on this site: no scheme, no host, no protocol-relative `//`. */
export const safeBack = (value: unknown): string => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData().catch(() => null);
  startCollector(__FLEET_DIR__);
  return redirect(safeBack(form?.get('back')), 303);
};
