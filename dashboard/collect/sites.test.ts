import { describe, expect, it } from 'vitest';
import { checkSite } from './sites.ts';

const cert = async () => '2027-01-31T23:59:59.000Z';
const response = (status: number, url: string) => ({ status, url, body: { cancel: async () => {} } }) as unknown as Response;

describe('site check', () => {
  it('reports status, time, the redirect target and the certificate', async () => {
    const r = await checkSite('my-site', 'https://example.com', { fetchImpl: async () => response(200, 'https://example.com/demo/'), certImpl: cert });
    expect(r).toMatchObject({ repo: 'my-site', status: 200, ok: true, finalUrl: 'https://example.com/demo/', certExpires: '2027-01-31T23:59:59.000Z', error: null });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('ignores a trailing slash as redirect target', async () => {
    const r = await checkSite('x', 'https://example.org', { fetchImpl: async () => response(200, 'https://example.org/'), certImpl: cert });
    expect(r.finalUrl).toBeNull();
  });

  it('marks 4xx and 5xx as down', async () => {
    const r = await checkSite('x', 'https://example.net', { fetchImpl: async () => response(503, 'https://example.net'), certImpl: cert });
    expect(r).toMatchObject({ ok: false, status: 503, error: 'HTTP 503' });
  });

  it('names the cause of a failed request', async () => {
    const r = await checkSite('x', 'https://nope.example', {
      fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); },
      certImpl: async () => null,
    });
    expect(r).toMatchObject({ ok: false, status: null, ms: null, error: 'ENOTFOUND', certExpires: null });
  });

  it('skips the certificate for http', async () => {
    let asked = false;
    await checkSite('x', 'http://example.test', { fetchImpl: async () => response(200, 'http://example.test'), certImpl: async () => { asked = true; return null; } });
    expect(asked).toBe(false);
  });
});
