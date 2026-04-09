import axios from 'axios';
import type { DeribitCandle } from '../types';
import { API_CONFIG } from './config';

// DERIBIT_API_BASE kept for reference but no longer used for candle fetches.
// Candles now use WebSocket (see fetchDeribitViaWS) which bypasses the Worker entirely.
const { DERIBIT_API_BASE: _DERIBIT_API_BASE } = API_CONFIG; void _DERIBIT_API_BASE;
const DERIBIT_DIRECT = 'https://www.deribit.com';
const DERIBIT_WS = 'wss://www.deribit.com/ws/api/v2';

// ─── Client-side caches ───────────────────────────────────────────────────────
// Two-layer cache: in-memory (fast, cleared on refresh) + localStorage (persists
// across page refreshes and new deployments). localStorage is the main defence
// against Deribit 429s — a fetched candle set is reused for 1 hour even if the
// user refreshes the page or re-opens the app.

interface CacheEntry<T> { data: T; ts: number }

const candleCache   = new Map<string, CacheEntry<DeribitCandle[]>>();
const instCache     = new Map<string, CacheEntry<number[]>>();
const dvolCache     = new Map<string, CacheEntry<Map<number, number>>>();
const CANDLE_TTL_MS = 60 * 60 * 1000; // 1 hr  (was 2 min — too short, caused cache misses after refresh)
const INST_TTL_MS   = 60 * 60 * 1000; // 1 hr
const DVOL_TTL_MS   = 60 * 60 * 1000; // 1 hr

const LS_PREFIX  = 'deribit_cache_v1_';
const LS_TTL_MS  = 60 * 60 * 1000; // 1 hr localStorage TTL

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const e = map.get(key);
  return e && Date.now() - e.ts < ttl ? e.data : null;
}

// localStorage helpers — store/retrieve JSON-serialisable data with a timestamp.
// DeribitCandle[] serialises trivially. Map<number,number> needs special handling.
function lsGet<T>(key: string, reviver?: (raw: unknown) => T): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const entry: { data: unknown; ts: number } = JSON.parse(raw);
    if (Date.now() - entry.ts > LS_TTL_MS) { localStorage.removeItem(LS_PREFIX + key); return null; }
    return reviver ? reviver(entry.data) : entry.data as T;
  } catch { return null; }
}

function lsSet(key: string, data: unknown): void {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ data, ts: Date.now() })); } catch { /* quota exceeded — ignore */ }
}

/** Round a millisecond timestamp down to the nearest hour.
 *  Used in cache keys so that runs seconds apart share the same cached result. */
function hourFloor(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

/**
 * Call a Deribit public JSON-RPC method over WebSocket.
 * WebSocket bypasses the Cloudflare Worker entirely — each user has their own
 * connection and their own rate-limit bucket (not shared across all app users).
 * WebSocket doesn't use HTTP CORS, so it works directly from any browser origin.
 */
function fetchDeribitViaWS(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const id = Math.random().toString(36).slice(2, 10);
    const ws = new WebSocket(DERIBIT_WS);

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      fn();
    };

    const timer = setTimeout(() => {
      done(() => reject(new Error('Deribit WebSocket timeout')));
    }, 20_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.id !== id) return; // not our reply
        if (msg.error) {
          done(() => reject(new Error(`Deribit error: ${msg.error.message} (code ${msg.error.code})`)));
        } else {
          done(() => resolve(msg.result));
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => done(() => reject(new Error('Deribit WebSocket error')));
    ws.onclose = (e: CloseEvent) => {
      if (!settled) done(() => reject(new Error(`Deribit WebSocket closed (${e.code})`)));
    };
  });
}

export async function fetchDeribitCandles(
  instrumentName: string,
  startMs: number,
  endMs: number,
  resolution: number = 60
): Promise<DeribitCandle[]> {
  const cacheKey = `${instrumentName}|${hourFloor(startMs)}|${hourFloor(endMs)}|${resolution}`;
  const cached = getCached(candleCache, cacheKey, CANDLE_TTL_MS);
  if (cached) return cached;
  // Check localStorage — survives page refresh
  const lsCached = lsGet<DeribitCandle[]>(cacheKey);
  if (lsCached) { candleCache.set(cacheKey, { data: lsCached, ts: Date.now() }); return lsCached; }

  const MAX_RETRIES = 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deribitThrottle();
      // Use WebSocket — bypasses Cloudflare Worker, uses user's own IP + rate-limit bucket.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchDeribitViaWS('public/get_tradingview_chart_data', {
        instrument_name: instrumentName,
        start_timestamp: startMs,
        end_timestamp: endMs,
        resolution: String(resolution),
      }) as any;

      if (!result?.ticks || !Array.isArray(result.ticks) || result.ticks.length === 0 || result.status === 'no_data') {
        return [];
      }
      const candles: DeribitCandle[] = result.ticks.map((t: number, i: number) => ({
        timestamp: t,
        open: result.open[i],
        high: result.high[i],
        low: result.low[i],
        close: result.close[i],
      }));
      candleCache.set(cacheKey, { data: candles, ts: Date.now() });
      lsSet(cacheKey, candles);
      return candles;
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Deribit sends rate-limit as an error in the WS response body (code 10028)
      if (msg.includes('10028') && attempt < MAX_RETRIES) {
        await delay(3000 * (attempt + 1));
        continue;
      }
      if (msg.includes('not_found') || msg.includes('not found')) {
        throw new Error(
          `${instrumentName} not found on Deribit. ` +
          `Deribit lists options on its own strike grid. ` +
          `If the option expired recently it may have been removed from the API.`
        );
      }
      throw err;
    }
  }
  throw lastErr;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Synthesize hourly candles from actual Deribit trade records.
 * Useful as a fallback when `get_tradingview_chart_data` returns nothing for
 * illiquid or short-dated daily/weekly options that have no mark-price history.
 * Returns [] if the instrument has no trades in the requested window.
 */
export async function fetchDeribitTradesAsCandles(
  instrumentName: string,
  startMs: number,
  endMs: number,
  resolutionMs: number = 3_600_000, // 1 hour default
): Promise<DeribitCandle[]> {
  const cacheKey = `trades|${instrumentName}|${hourFloor(startMs)}|${hourFloor(endMs)}`;
  const cached = getCached(candleCache, cacheKey, CANDLE_TTL_MS);
  if (cached) return cached;
  const lsCached = lsGet<DeribitCandle[]>(cacheKey);
  if (lsCached) { candleCache.set(cacheKey, { data: lsCached, ts: Date.now() }); return lsCached; }

  const allTrades: { timestamp: number; price: number }[] = [];
  let fetchStart = startMs;
  const MAX_PAGES = 20;

  for (let page = 0; page < MAX_PAGES; page++) {
    await deribitThrottle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchDeribitViaWS('public/get_last_trades_by_instrument_and_time', {
      instrument_name: instrumentName,
      start_timestamp: fetchStart,
      end_timestamp: endMs,
      count: 1000,
      sorting: 'asc',
    }) as any;

    const trades: { timestamp: number; price: number }[] = result?.trades ?? [];
    if (trades.length === 0) break;

    for (const t of trades) {
      if (t.timestamp >= startMs && t.timestamp <= endMs) {
        allTrades.push({ timestamp: t.timestamp, price: t.price });
      }
    }

    if (!result?.has_more) break;
    fetchStart = trades[trades.length - 1].timestamp + 1;
    if (fetchStart >= endMs) break;
  }

  if (allTrades.length === 0) {
    candleCache.set(cacheKey, { data: [], ts: Date.now() });
    return [];
  }

  // Bin trades into resolution-wide candles (OHLC)
  const buckets = new Map<number, number[]>();
  for (const t of allTrades) {
    const bucket = Math.floor(t.timestamp / resolutionMs) * resolutionMs;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(t.price);
  }

  const candles: DeribitCandle[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, prices]) => ({
      timestamp: bucket,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    }));

  candleCache.set(cacheKey, { data: candles, ts: Date.now() });
  lsSet(cacheKey, candles);
  return candles;
}

// ─── Simple rate limiter ──────────────────────────────────────────────────────
// Deribit's public API rate-limits aggressively. Space all outgoing calls by at
// least MIN_INTERVAL_MS to avoid cascading 429s across multiple positions.
let _lastCallMs = 0;
const MIN_INTERVAL_MS = 1200; // ms between consecutive Deribit API requests

async function deribitThrottle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - _lastCallMs);
  if (wait > 0) await delay(wait);
  _lastCallMs = Date.now();
}

/** Fetch available BTC or ETH option instruments from Deribit for a given expiry date.
 *  Returns sorted list of strikes so the UI can show nearest available.
 *  Set `includeExpired` to also search expired instruments (for historical data). */
export async function fetchDeribitStrikes(
  currency: 'BTC' | 'ETH',
  expiryLabel: string, // e.g. "29MAR26"
  includeExpired = false,
): Promise<number[]> {
  const cacheKey = `${currency}|${expiryLabel}|${includeExpired}`;
  const cached = getCached(instCache, cacheKey, INST_TTL_MS);
  if (cached) return cached;

  const MAX_RETRIES = 3;

  async function fetchWithRetry(params: Record<string, unknown>) {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await deribitThrottle();
        return await axios.get(`${DERIBIT_DIRECT}/api/v2/public/get_instruments`, { params });
      } catch (err: unknown) {
        lastErr = err;
        if (axios.isAxiosError(err) && err.response?.status === 429 && attempt < MAX_RETRIES) {
          await delay(2000 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  const activeResp = await fetchWithRetry({ currency, kind: 'option', expired: false });
  const responses = [activeResp];
  if (includeExpired) {
    const expiredResp = await fetchWithRetry({ currency, kind: 'option', expired: true });
    responses.push(expiredResp);
  }

  const instruments: { instrument_name: string; strike: number }[] = responses.flatMap(
    r => r.data?.result ?? [],
  );
  const strikes = [...new Set(
    instruments
      .filter(i => i.instrument_name.includes(`-${expiryLabel}-`))
      .map(i => i.strike),
  )].sort((a, b) => a - b);
  instCache.set(cacheKey, { data: strikes, ts: Date.now() });
  return strikes;
}

/** Resolve a Bybit-style option symbol to a valid Deribit instrument name.
 *  If the exact strike exists on Deribit, returns the same name.
 *  Otherwise returns the nearest available strike instrument. */
export async function resolveDeribitInstrument(
  bybitSymbol: string, // e.g. "BTC-29MAR26-72000-C" or "BTC-29MAR26-72000-C-USDT"
): Promise<{ instrumentName: string; exactMatch: boolean }> {
  const parts = bybitSymbol.split('-');
  // Strip trailing USDT suffix
  if (parts.length === 5 && parts[4] === 'USDT') parts.pop();
  if (parts.length !== 4) throw new Error(`Invalid option symbol: ${bybitSymbol}`);

  const [currency, expiryLabel, strikeStr, type] = parts;
  const strike = parseFloat(strikeStr);
  const deribitName = `${currency}-${expiryLabel}-${strike}-${type}`;

  const strikes = await fetchDeribitStrikes(currency as 'BTC' | 'ETH', expiryLabel, true);
  if (strikes.length === 0) throw new Error(`No Deribit instruments found for ${currency} ${expiryLabel}`);

  if (strikes.includes(strike)) {
    return { instrumentName: deribitName, exactMatch: true };
  }

  // Find nearest strike
  const nearest = strikes.reduce((prev, curr) =>
    Math.abs(curr - strike) < Math.abs(prev - strike) ? curr : prev,
  );
  return {
    instrumentName: `${currency}-${expiryLabel}-${nearest}-${type}`,
    exactMatch: false,
  };
}

export function validateDeribitInstrument(name: string): boolean {
  return /^(BTC|ETH)-\d{1,2}[A-Z]{3}\d{2}-\d+-[CP]$/.test(name);
}

/**
 * Fetch the Deribit Volatility Index (DVOL) for BTC or ETH.
 * DVOL is a 30-day at-the-money implied vol index — a good time-varying IV
 * proxy for Black-Scholes reconstruction when per-instrument history is unavailable.
 *
 * Returns a Map of floor-to-hour timestamp (seconds) → IV as a fraction (e.g. 0.55 = 55%).
 * Returns an empty map on any error — callers should fall back to a fixed IV.
 */
export async function fetchDeribitVolIndex(
  currency: 'BTC' | 'ETH',
  startMs: number,
  endMs: number,
): Promise<Map<number, number>> {
  const cacheKey = `dvol|${currency}|${hourFloor(startMs)}|${hourFloor(endMs)}`;
  const cached = getCached(dvolCache, cacheKey, DVOL_TTL_MS);
  if (cached) return cached;
  // Check localStorage (Map serialised as [key, value][] pairs)
  const lsCached = lsGet<[number, number][]>(cacheKey);
  if (lsCached) {
    const m = new Map<number, number>(lsCached);
    dvolCache.set(cacheKey, { data: m, ts: Date.now() });
    return m;
  }

  const MAX_DVOL_RETRIES = 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_DVOL_RETRIES; attempt++) {
    try {
      await deribitThrottle();
      const response = await axios.get(`${DERIBIT_DIRECT}/api/v2/public/get_volatility_index_data`, {
        params: { currency, start_timestamp: startMs, end_timestamp: endMs, resolution: 3600 },
      });

      const deribitError = response.data?.error;
      if (deribitError) throw new Error(`DVOL error: ${deribitError.message}`);

      // Response: { result: { data: [[timestamp_ms, open, high, low, close], ...] } }
      const data: [number, number, number, number, number][] = response.data?.result?.data ?? [];
      const result = new Map<number, number>();
      for (const [tMs, , , , close] of data) {
        const tSec = Math.floor(tMs / 1000 / 3600) * 3600; // floor to hour boundary in seconds
        result.set(tSec, close / 100); // percent → fraction
      }

      dvolCache.set(cacheKey, { data: result, ts: Date.now() });
      lsSet(cacheKey, [...result.entries()]); // Map → [key,value][] for JSON
      return result;
    } catch (err: unknown) {
      lastErr = err;
      if (axios.isAxiosError(err) && err.response?.status === 429 && attempt < MAX_DVOL_RETRIES) {
        await delay(2000 * Math.pow(2, attempt));
        continue;
      }
      break; // non-429 error — don't retry
    }
  }

  // Non-fatal — caller falls back to fixed IV; log for debugging
  console.warn('DVOL fetch failed:', lastErr);
  return new Map();
}
