import axios from 'axios';
import type { CryptoOption } from '../types';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

const CRYPTO_SYMBOLS: Record<CryptoOption, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

export interface OHLCCandle {
  t: number; // Unix seconds (candle open time)
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Fetch current spot price for a crypto asset */
export async function fetchCurrentPrice(crypto: CryptoOption): Promise<number> {
  const symbol = CRYPTO_SYMBOLS[crypto];
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
  const symbol = CRYPTO_SYMBOLS[crypto as 'BTC' | 'ETH'] ?? CRYPTO_SYMBOLS.BTC;
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
