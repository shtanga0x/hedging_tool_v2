/**
 * bybit_library.ts
 * ----------------
 * Client for the local BTC Options Library API (api_server.py).
 * The server reads from the Parquet midprice library built by build_library.py.
 *
 * Start the server with:
 *   python btc-options-lib/api_server.py
 */

const BASE = 'http://127.0.0.1:8765';

export interface LibraryCandle {
  timestamp: number;  // Unix milliseconds
  close: number;      // midprice in USDT
}

export interface LibraryCatalogEntry {
  date: string;
  expiry: string;
  strike: number;
  option_type: string;  // "C" or "P"
}

/**
 * Fetch midprice time series for one option from the local library.
 *
 * @param expiry      e.g. "10APR26"
 * @param strike      e.g. 67500
 * @param optionType  "C" or "P"
 * @param dateFrom    "YYYY-MM-DD" (optional)
 * @param dateTo      "YYYY-MM-DD" (optional)
 * @param resample    pandas freq string e.g. "1h", "5min" (optional — returns all ticks if omitted)
 */
export async function fetchBybitLibraryMidprice(
  expiry: string,
  strike: number,
  optionType: 'C' | 'P',
  dateFrom?: string,
  dateTo?: string,
  resample?: string,
): Promise<LibraryCandle[]> {
  const params = new URLSearchParams({
    expiry,
    strike: String(strike),
    option_type: optionType,
  });
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo)   params.set('date_to',   dateTo);
  if (resample) params.set('resample',  resample);

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/midprice?${params}`);
  } catch {
    throw new Error(
      'Bybit library server not reachable. Start it with: python btc-options-lib/api_server.py'
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bybit library API error ${res.status}: ${text}`);
  }

  const { timestamps, midprices } = await res.json() as {
    timestamps: number[];
    midprices: number[];
  };

  return timestamps.map((ts, i) => ({ timestamp: ts, close: midprices[i] }));
}

/** Fetch the full catalog of available (date, expiry, strike, option_type) combinations. */
export async function fetchBybitLibraryCatalog(): Promise<LibraryCatalogEntry[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/catalog`);
  } catch {
    throw new Error('Bybit library server not reachable.');
  }
  if (!res.ok) throw new Error(`Bybit library catalog error ${res.status}`);
  return res.json();
}

/** Quick check whether the API server is running. */
export async function checkBybitLibraryHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
