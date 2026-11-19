/**
 * Prices per token from the public LiteLLM list (the source ccusage uses too). Fetched on every run
 * and cached in .cache/; offline the cache is used. pricing.overrides.json (in Git, normally `{}`)
 * fills in or corrects models, with LiteLLM's keys, per token:
 *
 *   { "some-model": { "input_cost_per_token": 3e-6, "output_cost_per_token": 1.5e-5 } }
 *
 * Costs are API list prices, not money paid on a subscription.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** A model's entry in the LiteLLM list (the fields used here). */
export interface RawPrice {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  /** Cache write kept 5 minutes. */
  cache_creation_input_token_cost?: number;
  /** Cache write kept 1 hour. */
  cache_creation_input_token_cost_above_1hr?: number;
}
export type PriceTable = Record<string, RawPrice>;

/** USD per token. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/**
 * The price of `model`: exact name, then with an `anthropic/` or `openai/` prefix. Missing cache
 * prices fall back to the next better known one (1 h write → 5 min write → input).
 */
export function priceOf(model: string, table: PriceTable): ModelPrice | null {
  const raw = table[model] ?? table[`anthropic/${model}`] ?? table[`openai/${model}`];
  if (!raw || typeof raw.input_cost_per_token !== 'number') return null;
  const input = raw.input_cost_per_token;
  const write5m = raw.cache_creation_input_token_cost ?? input;
  return {
    input,
    output: raw.output_cost_per_token ?? 0,
    cacheRead: raw.cache_read_input_token_cost ?? input,
    cacheWrite5m: write5m,
    cacheWrite1h: raw.cache_creation_input_token_cost_above_1hr ?? write5m,
  };
}

export const costOf = (t: TokenCounts, p: ModelPrice): number =>
  t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite5m * p.cacheWrite5m + t.cacheWrite1h * p.cacheWrite1h;

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const isTable = (v: unknown): v is PriceTable => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The price table: fresh from LiteLLM (then cached), else the cache, with the overrides on top.
 * `source` says which; `none` means no prices at all (offline on the first run).
 */
export async function loadPrices(opts: { cacheFile: string; overridesFile: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ table: PriceTable; source: 'fresh' | 'cache' | 'none'; error?: string }> {
  const { cacheFile, overridesFile, fetchImpl = fetch, timeoutMs = 15_000 } = opts;
  let table: PriceTable = {};
  let source: 'fresh' | 'cache' | 'none' = 'none';
  let error: string | undefined;
  try {
    const res = await fetchImpl(LITELLM_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!isTable(data)) throw new Error('unexpected price list');
    table = data;
    source = 'fresh';
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(data));
  } catch (err) {
    error = (err as Error).message;
    if (existsSync(cacheFile)) {
      const cached = readJson(cacheFile);
      if (isTable(cached)) {
        table = cached;
        source = 'cache';
      }
    }
  }
  if (existsSync(overridesFile)) {
    const overrides = readJson(overridesFile);
    if (!isTable(overrides)) throw new Error(`${overridesFile}: expected an object of models`);
    for (const [model, price] of Object.entries(overrides)) table[model] = { ...table[model], ...price };
  }
  return { table, source, ...(error ? { error } : {}) };
}
