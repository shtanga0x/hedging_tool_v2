import axios from 'axios';
import type { CryptoOption } from '../types';
import { API_CONFIG } from './config';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';
const { BYBIT_API_BASE, STOOQ_API_BASE } = API_CONFIG;

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

/** Fetch current spot/reference price for a supported asset */
export async function fetchCurrentPrice(crypto: CryptoOption): Promise<number> {
  const symbol = CRYPTO_SYMBOLS[crypto];
  if (!symbol) {
    const bybitSpot = await fetchBybitSpot(crypto);
    if (bybitSpot > 0) return bybitSpot;
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
  if (!symbol) return fetchStooqCandles(crypto, startTime, endTime);
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
    const candles = await fetchStooqCandles(crypto, startTime, endTime);
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
