/**
 * Site checks: is each `site` of fleet.json reachable, how fast, and when does its TLS certificate
 * expire. Needs the network, so it runs in the collector and lands in .cache/snapshot.json.
 */
import { connect } from 'node:tls';

export interface SiteCheck {
  repo: string;
  url: string;
  /** HTTP status of the final response; null when there was none. */
  status: number | null;
  /** 2xx or 3xx at the end of the redirects. */
  ok: boolean;
  /** Time to the response headers. */
  ms: number | null;
  /** Where the redirects ended, when not the URL itself. */
  finalUrl: string | null;
  /** Expiry of the certificate (ISO); null for http or when it could not be read. */
  certExpires: string | null;
  error: string | null;
  checkedAt: string;
}

/** Reads the certificate's expiry of `host` (port 443); null on any failure. */
export function certExpiry(host: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const at = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
      resolve(Number.isNaN(at) ? null : new Date(at).toISOString());
    });
    const fail = () => {
      socket.destroy();
      resolve(null);
    };
    socket.on('error', fail);
    socket.on('timeout', fail);
  });
}

/** A short reason for a failed fetch: the cause's code or message, not Node's "fetch failed". */
function reason(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  return (e.cause?.code || e.cause?.message || e.message || 'failed').toString().slice(0, 120);
}

/** Checks one site: GET with redirects (some hosts refuse HEAD), and its certificate in parallel. */
export async function checkSite(repo: string, url: string, opts: { fetchImpl?: typeof fetch; certImpl?: (host: string) => Promise<string | null>; timeoutMs?: number } = {}): Promise<SiteCheck> {
  const { fetchImpl = fetch, certImpl = certExpiry, timeoutMs = 15_000 } = opts;
  const checkedAt = new Date().toISOString();
  const u = new URL(url);
  const cert = u.protocol === 'https:' ? certImpl(u.hostname) : Promise.resolve(null);
  const started = performance.now();
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'fleet-dashboard site check' } });
    const ms = Math.round(performance.now() - started);
    await res.body?.cancel();
    const final = res.url && res.url !== url && res.url.replace(/\/$/, '') !== url.replace(/\/$/, '') ? res.url : null;
    return { repo, url, status: res.status, ok: res.status < 400, ms, finalUrl: final, certExpires: await cert, error: res.status < 400 ? null : `HTTP ${res.status}`, checkedAt };
  } catch (err) {
    return { repo, url, status: null, ok: false, ms: null, finalUrl: null, certExpires: await cert, error: reason(err), checkedAt };
  }
}
