import axios from 'axios';
import type { BybitBaseCoin, BybitInstrument, BybitTicker, BybitOptionChain } from '../types';
import { API_CONFIG } from './config';

const { BYBIT_API_BASE } = API_CONFIG;

// 30-second in-memory cache
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30_000;
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data as T;
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** Parse Bybit symbol like "BTC-28FEB25-100000-C" or "BTC-27MAR26-86000-P-USDT" */
export function parseBybitSymbol(symbol: string): {
  base: string;
  expiryStr: string;
  strike: number;
  optionsType: 'Call' | 'Put';
} | null {
  const parts = symbol.split('-');
  // Strip trailing USDT suffix (5-part format)
  if (parts.length === 5 && parts[4] === 'USDT') parts.pop();
  if (parts.length !== 4) return null;
  const strike = parseFloat(parts[2]);
  if (isNaN(strike)) return null;
  if (parts[3] !== 'C' && parts[3] !== 'P') return null;
  return {
    base: parts[0],
    expiryStr: parts[1],
    strike,
    optionsType: parts[3] === 'C' ? 'Call' : 'Put',
  };
}

const SPOT_SYMBOLS: Record<BybitBaseCoin, string> = {
  BTC: 'BTCUSDT',
  XAUT: 'XAUTUSDT',
};

/** Fetch option instruments from Bybit V5 (with cursor pagination) */
export async function fetchBybitInstruments(baseCoin: BybitBaseCoin = 'BTC'): Promise<BybitInstrument[]> {
  const cacheKey = `bybit-instruments-${baseCoin}`;
  const cached = getCached<BybitInstrument[]>(cacheKey);
  if (cached) return cached;

  const instruments: BybitInstrument[] = [];
  let cursor = '';

  do {
    const params: Record<string, string> = { category: 'option', baseCoin };
    if (cursor) params.cursor = cursor;

    const resp = await axios.get(`${BYBIT_API_BASE}/v5/market/instruments-info`, { params });
    const list = resp.data?.result?.list || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of list as any[]) {
      const parsed = parseBybitSymbol(item.symbol);
      if (!parsed || parsed.base !== baseCoin) continue;
      instruments.push({
        symbol: item.symbol,
        optionsType: parsed.optionsType,
        strike: parsed.strike,
        expiryTimestamp: parseInt(item.deliveryTime, 10),
      });
    }

    cursor = resp.data?.result?.nextPageCursor || '';
  } while (cursor);

  setCache(cacheKey, instruments);
  return instruments;
}

/** Fetch option tickers from Bybit V5 (with cursor pagination) */
export async function fetchBybitTickers(baseCoin: BybitBaseCoin = 'BTC'): Promise<Map<string, BybitTicker>> {
  const cacheKey = `bybit-tickers-${baseCoin}`;
  const cached = getCached<Map<string, BybitTicker>>(cacheKey);
  if (cached) return cached;

  const tickers = new Map<string, BybitTicker>();
  let cursor = '';

  do {
    const params: Record<string, string> = { category: 'option', baseCoin };
    if (cursor) params.cursor = cursor;

    const resp = await axios.get(`${BYBIT_API_BASE}/v5/market/tickers`, { params });
    const list = resp.data?.result?.list || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of list as any[]) {
      tickers.set(item.symbol, {
        symbol: item.symbol,
        bid1Price: parseFloat(item.bid1Price) || 0,
        ask1Price: parseFloat(item.ask1Price) || 0,
        markPrice: parseFloat(item.markPrice) || 0,
        markIv: parseFloat(item.markIv) || 0,
        delta: parseFloat(item.delta) || 0,
        gamma: parseFloat(item.gamma) || 0,
        vega: parseFloat(item.vega) || 0,
        theta: parseFloat(item.theta) || 0,
      });
    }

    cursor = resp.data?.result?.nextPageCursor || '';
  } while (cursor);

  setCache(cacheKey, tickers);
  return tickers;
}

/** Fetch spot/index price from Bybit for option-chain underlyings */
export async function fetchBybitSpotPrice(baseCoin: BybitBaseCoin = 'BTC'): Promise<number> {
  const cacheKey = `bybit-spot-${baseCoin}`;
  const cached = getCached<number>(cacheKey);
  if (cached) return cached;

  const resp = await axios.get(`${BYBIT_API_BASE}/v5/market/tickers`, {
    params: { category: 'spot', symbol: SPOT_SYMBOLS[baseCoin] },
  });

  const row = resp.data?.result?.list?.[0] ?? {};
  const price = parseFloat(row.usdIndexPrice) || parseFloat(row.lastPrice) || 0;
  setCache(cacheKey, price);
  return price;
}

/** Group instruments by expiry into BybitOptionChain[], sorted chronologically */
export function groupByExpiry(
  instruments: BybitInstrument[],
  tickers: Map<string, BybitTicker>,
  baseCoin?: BybitBaseCoin,
): BybitOptionChain[] {
  const groups = new Map<number, BybitInstrument[]>();

  for (const inst of instruments) {
    const existing = groups.get(inst.expiryTimestamp) || [];
    existing.push(inst);
    groups.set(inst.expiryTimestamp, existing);
  }

  const chains: BybitOptionChain[] = [];
  for (const [expiryTs, insts] of groups) {
    const date = new Date(expiryTs);
    // Bybit settles at 08:00 UTC — format in UTC so the expiry day doesn't shift
    // for users in negative-offset timezones.
    const expiryLabel = date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    // Filter tickers for this expiry's instruments
    const chainTickers = new Map<string, BybitTicker>();
    for (const inst of insts) {
      const t = tickers.get(inst.symbol);
      if (t) chainTickers.set(inst.symbol, t);
    }

    // Sort instruments by strike
    insts.sort((a, b) => a.strike - b.strike);

    chains.push({
      baseCoin,
      expiryLabel,
      expiryTimestamp: expiryTs,
      instruments: insts,
      tickers: chainTickers,
    });
  }

  // Sort chronologically
  chains.sort((a, b) => a.expiryTimestamp - b.expiryTimestamp);
  return chains;
}
