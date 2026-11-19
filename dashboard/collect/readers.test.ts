import { describe, expect, it } from 'vitest';
import { codexClient, parseCodexLines } from './codex.ts';
import { parsePiLines } from './pi.ts';

const j = (o: unknown) => JSON.stringify(o);
const usage = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output });

describe('Codex reader', () => {
  const meta = j({ type: 'session_meta', payload: { session_id: 's1', cwd: '/repos/AI/my-site', originator: 'T3 Code' } });
  const turn = (model: string) => j({ type: 'turn_context', payload: { model, cwd: '/repos/AI/my-site' } });
  const count = (ts: string, u: object) => j({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: u } } });

  it('takes the growth of the running total, skips repeats, moves cached input to cache read', () => {
    const events = parseCodexLines([
      meta, turn('gpt-6-astra'),
      count('2026-11-18T10:00:00Z', usage(1000, 600, 50)),
      count('2026-11-18T10:00:01Z', usage(1000, 600, 50)), // repeated
      count('2026-11-18T10:01:00Z', usage(2500, 1800, 80)),
    ]).map((e) => e.event);
    expect(events.map((e) => [e.input, e.cacheRead, e.output, e.model, e.client, e.branch])).toEqual([
      [400, 600, 50, 'gpt-6-astra', 't3-code', null],
      [300, 1200, 30, 'gpt-6-astra', 't3-code', null],
    ]);
  });

  it('prefers per-response records when the file has them, keyed by response id', () => {
    const record = (id: string, ts: string) => j({ type: 'token_usage_record', timestamp: ts, payload: { response_id: id, usage: usage(100, 40, 10) } });
    const parsed = parseCodexLines([meta, turn('gpt-6-astra'), count('2026-11-18T10:00:00Z', usage(9999, 0, 999)), record('resp_a', '2026-11-18T10:00:00Z'), record('resp_b', '2026-11-18T10:01:00Z')]);
    expect(parsed.map((p) => p.key)).toEqual(['resp_a', 'resp_b']);
    expect(parsed[0].event).toMatchObject({ input: 60, cacheRead: 40, output: 10 });
  });

  it('names the clients', () => {
    expect(['Codex Desktop', 'codex_work_desktop', 't3code_desktop', 'codex_cli_rs', 'codex-tui', 'codex_exec', 'zed', undefined].map(codexClient))
      .toEqual(['codex-desktop', 'codex-desktop', 't3-code', 'cli', 'cli', 'exec', 'zed', 'unknown']);
  });
});

describe('Pi reader', () => {
  const header = j({ type: 'session', id: 'p1', cwd: '/repos/AI/my-app', timestamp: '2026-11-18T09:00:00Z' });
  const reply = (id: string, responseId: string | undefined, cost: number) => j({
    type: 'message', id, timestamp: '2026-11-18T10:00:00Z',
    message: { role: 'assistant', model: 'claude-opus-5-5', provider: 'anthropic', ...(responseId ? { responseId } : {}), usage: { input: 4, output: 278, cacheRead: 10, cacheWrite: 500, cacheWrite1h: 200, cost: { total: cost } } },
  });

  it('reads cwd from the header, usage and Pi’s own cost from each reply', () => {
    const [p] = parsePiLines([header, reply('e1', 'resp_1', 0.2976)]);
    expect(p.key).toBe('resp_1');
    expect(p.event).toMatchObject({ app: 'pi', client: 'pi', sessionId: 'p1', cwd: '/repos/AI/my-app', input: 4, output: 278, cacheRead: 10, cacheWrite5m: 300, cacheWrite1h: 200, loggedCost: 0.2976, branch: null });
  });

  it('keys replies without a response id by session and entry, and skips user messages', () => {
    const user = j({ type: 'message', id: 'u1', timestamp: '2026-11-18T10:00:00Z', message: { role: 'user', usage: { input: 1 } } });
    expect(parsePiLines([header, user, reply('e2', undefined, 0.1)]).map((p) => p.key)).toEqual(['p1:e2']);
  });
});
