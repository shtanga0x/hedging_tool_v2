import axios from 'axios';
import type { CryptoOption } from '../types';
import { API_CONFIG } from './config';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';
const { BYBIT_API_BASE, STOOQ_API_BASE, YAHOO_API_BASE, PYTH_API_BASE } = API_CONFIG;

const CRYPTO_SYMBOLS: Partial<Record<CryptoOption, string>> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

const BYBIT_SPOT_SYMBOLS: Partial<Record<CryptoOption, string>> = {
  XAUT: 'XAUTUSDT',
};

const STOOQ_SYMBOLS: Partial<Record<CryptoOption, { symbol: string; scale?: number }>> = {
  WTI: { symbol: 'cl.f' },
  SI: { symbol: 'si.f', scale: 0.01 },
  SPY: { symbol: 'spy.us' },
  META: { symbol: 'meta.us' },
};

const YAHOO_SYMBOLS: Partial<Record<CryptoOption, string>> = {
  WTI: 'CL=F',
  SI: 'SI=F',
  SPY: 'SPY',
  META: 'META',
  XAUT: 'GC=F',
};

interface PythFeed {
  id: string;
  attributes?: {
    base?: string;
    description?: string;
    display_symbol?: string;
  };
}

export interface OHLCCandle {
  t: number; // Unix seconds (candle open time)
  o: number;
  h: number;
  l: number;
  c: number;
}

function parseCsvRows(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]?.trim() ?? '']));
  });
}

function formatStooqDate(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseStooqDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 1000);
}

async function fetchBybitSpot(asset: CryptoOption): Promise<number> {
  const symbol = BYBIT_SPOT_SYMBOLS[asset];
  if (!symbol) return 0;
  const response = await axios.get(`${BYBIT_API_BASE}/v5/market/tickers`, {
    params: { category: 'spot', symbol },
  });
  const row = response.data?.result?.list?.[0] ?? {};
  return parseFloat(row.usdIndexPrice) || parseFloat(row.lastPrice) || 0;
}

async function fetchStooqLatest(asset: CryptoOption): Promise<number> {
  const config = STOOQ_SYMBOLS[asset];
  if (!config) return 0;
  const response = await axios.get(`${STOOQ_API_BASE}/q/l/`, {
    params: { s: config.symbol, f: 'sd2t2ohlcv', h: '', e: 'csv' },
    responseType: 'text',
  });
  const row = parseCsvRows(String(response.data))[0];
  const close = parseFloat(row?.Close ?? '');
  const price = Number.isFinite(close) ? close * (config.scale ?? 1) : 0;
  return price > 0 ? price : 0;
}

async function fetchYahooLatest(asset: CryptoOption): Promise<number> {
  const symbol = YAHOO_SYMBOLS[asset];
  if (!symbol) return 0;
  const response = await axios.get(`${YAHOO_API_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    params: { range: '5d', interval: '1d' },
    responseType: 'json',
  });
  const meta = response.data?.chart?.result?.[0]?.meta ?? {};
  const candidates = [
    parseFloat(String(meta.regularMarketPrice ?? '')),
    parseFloat(String(meta.previousClose ?? '')),
    parseFloat(String(meta.chartPreviousClose ?? '')),
  ];
  const price = candidates.find(v => Number.isFinite(v) && v > 0) ?? 0;
  return price > 0 ? price : 0;
}

function parsePythWtiLastTradeDate(description: string): number {
  const match = description.match(/\b(\d{1,2})\s+([A-Z]+)\s+(\d{4})\b/);
  if (!match) return 0;
  const [, dayRaw, monthRaw, yearRaw] = match;
  const monthIndex = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ].indexOf(monthRaw);
  if (monthIndex < 0) return 0;
  return Date.UTC(Number(yearRaw), monthIndex, Number(dayRaw), 22, 0, 0);
}

async function fetchPythWtiLatest(): Promise<number> {
  const feedsResponse = await axios.get(`${PYTH_API_BASE}/v2/price_feeds`, {
    params: { query: 'WTI' },
    responseType: 'json',
  });
  const feeds = (feedsResponse.data as PythFeed[])
    .map(feed => {
      const description = feed.attributes?.description ?? '';
      return {
        id: feed.id,
        base: feed.attributes?.base ?? '',
        description,
        lastTradeMs: parsePythWtiLastTradeDate(description),
      };
    })
    .filter(feed =>
      feed.id &&
      /^WTI[A-Z]\d$/.test(feed.base) &&
      feed.lastTradeMs > 0 &&
      !/deprecated/i.test(feed.description)
    )
    .sort((a, b) => a.lastTradeMs - b.lastTradeMs);

  const rollBufferMs = 3 * 24 * 3600 * 1000;
  const activeFeed = feeds.find(feed => feed.lastTradeMs > Date.now() + rollBufferMs) ?? feeds[0];
  if (!activeFeed) return 0;

  const priceResponse = await axios.get(`${PYTH_API_BASE}/v2/updates/price/latest`, {
    params: { 'ids[]': activeFeed.id },
    responseType: 'json',
  });
  const price = priceResponse.data?.parsed?.[0]?.price;
  const raw = Number(price?.price);
  const expo = Number(price?.expo);
  if (!Number.isFinite(raw) || !Number.isFinite(expo)) return 0;
  const value = raw * Math.pow(10, expo);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function fetchStooqCandles(asset: CryptoOption, startTime: number, endTime: number): Promise<OHLCCandle[]> {
  const config = STOOQ_SYMBOLS[asset];
  if (!config) return [];
  const response = await axios.get(`${STOOQ_API_BASE}/q/d/l/`, {
    params: {
      s: config.symbol,
      d1: formatStooqDate(startTime),
      d2: formatStooqDate(endTime),
      i: 'd',
    },
    responseType: 'text',
  });
  const scale = config.scale ?? 1;
  return parseCsvRows(String(response.data))
    .map(row => ({
      t: parseStooqDate(row.Date),
      o: parseFloat(row.Open) * scale,
      h: parseFloat(row.High) * scale,
      l: parseFloat(row.Low) * scale,
      c: parseFloat(row.Close) * scale,
    }))
    .filter(c => c.t > 0 && [c.o, c.h, c.l, c.c].every(Number.isFinite));
}

async function fetchYahooCandles(asset: CryptoOption, startTime: number, endTime: number): Promise<OHLCCandle[]> {
  const symbol = YAHOO_SYMBOLS[asset];
  if (!symbol) return [];
  const response = await axios.get(`${YAHOO_API_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    params: {
      period1: startTime,
      period2: endTime,
      interval: '1d',
    },
    responseType: 'json',
  });
  const result = response.data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  return timestamps.map((t, i) => ({
    t,
    o: Number(quote.open?.[i]),
    h: Number(quote.high?.[i]),
    l: Number(quote.low?.[i]),
    c: Number(quote.close?.[i]),
  })).filter(c => c.t > 0 && [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0));
}

/** Fetch current spot/reference price for a supported asset */
export async function fetchCurrentPrice(crypto: CryptoOption): Promise<number> {
  const symbol = CRYPTO_SYMBOLS[crypto];
  if (!symbol) {
    const bybitSpot = await fetchBybitSpot(crypto);
    if (bybitSpot > 0) return bybitSpot;
    if (crypto === 'WTI') {
      const pythSpot = await fetchPythWtiLatest();
      if (pythSpot > 0) return pythSpot;
    }
    const yahooSpot = await fetchYahooLatest(crypto);
    if (yahooSpot > 0) return yahooSpot;
    const stooqSpot = await fetchStooqLatest(crypto);
    if (stooqSpot > 0) return stooqSpot;
    return 0;
  }
  const response = await axios.get(`${BINANCE_API_BASE}/ticker/price`, {
    params: { symbol },
  });
  return parseFloat(response.data.price);
}

/** Fetch OHLC candle data from Binance for use in Japanese candlestick charts */
export async function fetchCryptoCandles(
  crypto: CryptoOption,
  startTime: number,
  endTime: number,
  interval: string = '1h'
): Promise<OHLCCandle[]> {
  const symbol = CRYPTO_SYMBOLS[crypto];
  if (!symbol) {
    const yahooCandles = await fetchYahooCandles(crypto, startTime, endTime);
    if (yahooCandles.length > 0) return yahooCandles;
    return fetchStooqCandles(crypto, startTime, endTime);
  }
  const allCandles: OHLCCandle[] = [];
  let currentStartTime = startTime * 1000;
  const endTimeMs = endTime * 1000;

  while (currentStartTime < endTimeMs) {
    const response = await axios.get(`${BINANCE_API_BASE}/klines`, {
      params: { symbol, interval, startTime: currentStartTime, endTime: endTimeMs, limit: 1000 },
    });
    const klines = response.data as (string | number)[][];
    if (!klines.length) break;
    for (const k of klines) {
      allCandles.push({
        t: Math.floor((k[0] as number) / 1000),
        o: parseFloat(k[1] as string),
        h: parseFloat(k[2] as string),
        l: parseFloat(k[3] as string),
        c: parseFloat(k[4] as string),
      });
    }
    currentStartTime = (klines[klines.length - 1][0] as number) + 60000;
    if (klines.length < 1000) break;
  }
  return allCandles;
}

/** Fetch historical OHLCV data from Binance for a crypto asset as 5-min candles */
export async function fetchCryptoPriceHistory(
  crypto: CryptoOption,
  startTime: number,
  endTime: number
): Promise<{ t: number; p: number }[]> {
  const symbol = CRYPTO_SYMBOLS[crypto];
  if (!symbol) {
    const yahooCandles = await fetchYahooCandles(crypto, startTime, endTime);
    const candles = yahooCandles.length > 0 ? yahooCandles : await fetchStooqCandles(crypto, startTime, endTime);
    return candles.map(c => ({ t: c.t, p: c.c }));
  }
  const allKlines: { t: number; p: number }[] = [];
  let currentStartTime = startTime * 1000;
  const endTimeMs = endTime * 1000;

  while (currentStartTime < endTimeMs) {
    const response = await axios.get(`${BINANCE_API_BASE}/klines`, {
      params: { symbol, interval: '5m', startTime: currentStartTime, endTime: endTimeMs, limit: 1000 },
    });
    const klines = response.data as (string | number)[][];
    if (!klines.length) break;
    for (const k of klines) {
      allKlines.push({ t: Math.floor((k[0] as number) / 1000), p: parseFloat(k[4] as string) });
    }
    currentStartTime = (klines[klines.length - 1][0] as number) + 60000;
    if (klines.length < 1000) break;
  }
  return allKlines;
}
