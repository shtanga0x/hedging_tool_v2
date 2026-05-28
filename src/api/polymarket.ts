import axios from 'axios';
import type { PolymarketEvent, ParsedMarket, CryptoOption, OptionType } from '../types';
import { API_CONFIG } from './config';

const { GAMMA_API_BASE, CLOB_API_BASE } = API_CONFIG;

const DEFAULT_SEARCH_LIMIT = 10;

function parseEndDate(raw: unknown): number {
  if (!raw) return 0;
  const value = typeof raw === 'string' ? raw : String(raw);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function coerceEvents(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const events = (payload as { events?: unknown }).events;
    if (Array.isArray(events)) return events;
  }
  return [];
}

function mapToSearchResult(raw: Record<string, unknown>): EventSearchResult | null {
  const slug = String(raw.slug ?? '').trim();
  if (!slug) return null;
  const title = String(raw.title ?? raw.question ?? raw.ticker ?? '');
  return {
    id: String(raw.id ?? ''),
    slug,
    title,
    endDate: parseEndDate(raw.endDate),
    series: raw.series as EventSearchResult['series'],
  };
}

async function fetchSearchResults(endpoint: string, query: string): Promise<EventSearchResult[]> {
  const response = await axios.get(endpoint, {
    params: { q: query, limit: DEFAULT_SEARCH_LIMIT },
  });
  const rawEvents = coerceEvents(response.data);
  return rawEvents
    .map(mapToSearchResult)
    .filter((e): e is EventSearchResult => Boolean(e));
}

export interface EventSearchResult {
  id: string;
  slug: string;
  title: string;
  endDate: number; // Unix seconds
  series?: PolymarketEvent['series'];
}

export async function searchEvents(query: string): Promise<EventSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const primary = await fetchSearchResults(`${GAMMA_API_BASE}/public-search`, trimmed);
    if (primary.length > 0) return primary;
    return await fetchSearchResults(`${GAMMA_API_BASE}/events`, trimmed);
  } catch (primaryErr) {
    console.warn('[Polymarket] public search failed', primaryErr);
    try {
      return await fetchSearchResults(`${GAMMA_API_BASE}/events`, trimmed);
    } catch (fallbackErr) {
      console.error('[Polymarket] fallback event search failed', fallbackErr);
      throw fallbackErr;
    }
  }
}

export async function fetchPriceHistory(
  tokenId: string,
  startTs: string,
  fidelity: number = 10
): Promise<{ history: { t: number; p: number }[] }> {
  const response = await axios.get(`${CLOB_API_BASE}/prices-history`, {
    params: { market: tokenId, startTs, fidelity },
  });
  return response.data;
}

/** Parse ISO 8601 date string to Unix timestamp (seconds) */
function parseTimestamp(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

export async function fetchEventBySlug(slug: string): Promise<PolymarketEvent> {
  const response = await axios.get<PolymarketEvent>(
    `${GAMMA_API_BASE}/events/slug/${slug}`
  );
  const data = response.data;

  return {
    ...data,
    startDate: parseTimestamp(data.startDate as unknown as string),
    endDate: parseTimestamp(data.endDate as unknown as string),
    markets: data.markets
      .map((market) => ({
        ...market,
        startDate: parseTimestamp(market.startDate as unknown as string),
        endDate: parseTimestamp(market.endDate as unknown as string),
      }))
      .sort((a, b) => {
        if (a.groupItemThreshold && b.groupItemThreshold) {
          return a.groupItemThreshold - b.groupItemThreshold;
        }

        if (a.groupItemTitle && b.groupItemTitle) {
          return a.groupItemTitle.localeCompare(b.groupItemTitle);
        }

        return a.question.localeCompare(b.question);
      }),
  };
}

/** Parse strike price from groupItemTitle like "↑$100,000", "$96", or "↑$1.5T" */
export function parseStrikePrice(title: string): number {
  const cleaned = title.replace(/[↑↓$,\s_]/g, '').toUpperCase();
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)([KMBT])?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return 0;
  const multiplier = match[2] === 'T' ? 1e12
    : match[2] === 'B' ? 1e9
    : match[2] === 'M' ? 1e6
    : match[2] === 'K' ? 1e3
    : 1;
  return num * multiplier;
}

function parseOptionalPrice(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined;
  const v = typeof raw === 'string' ? parseFloat(raw) : raw;
  return isFinite(v) && v > 0 && v < 1 ? v : undefined;
}

function parseJsonArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseMarkets(markets: PolymarketEvent['markets']): ParsedMarket[] {
  const parsedMarkets = markets.flatMap((market) => {
    const tokenIds = parseJsonArray(market.clobTokenIds)
      ?.map((tokenId) => String(tokenId))
      .filter(Boolean);

    if (!tokenIds || tokenIds.length < 2) {
      console.warn('[Polymarket] Skipping market without CLOB token ids', {
        id: market.id,
        question: market.question,
      });
      return [];
    }

    let currentPrice = 0;
    const prices = parseJsonArray(market.outcomePrices);
    if (prices?.[0] != null) {
      const yesPrice = parseFloat(String(prices[0]));
      currentPrice = Number.isFinite(yesPrice) ? yesPrice : 0;
    }

    return [{
      id: market.id,
      question: market.question,
      groupItemTitle: market.groupItemTitle,
      groupItemThreshold: market.groupItemThreshold,
      endDate: market.endDate,
      startDate: market.startDate,
      yesTokenId: tokenIds[0],
      noTokenId: tokenIds[1],
      currentPrice,
      bestBid: parseOptionalPrice(market.bestBid),
      bestAsk: parseOptionalPrice(market.bestAsk),
      strikePrice: parseStrikePrice(market.groupItemTitle || ''),
    }];
  });

  if (markets.length > 0 && parsedMarkets.length === 0) {
    throw new Error('No tradable Polymarket markets found for this event.');
  }

  return parsedMarkets;
}

function collectSeriesText(series: PolymarketEvent['series']): string {
  const items = Array.isArray(series) ? series : series ? [series] : [];
  return items
    .flatMap(item => [
      item.cgAssetName,
      item.seriesSlug,
      item.slug,
      item.title,
      item.ticker,
    ])
    .filter(Boolean)
    .join(' ');
}

function eventSearchText(event: PolymarketEvent): string {
  return [
    event.slug,
    event.title,
    event.description,
    collectSeriesText(event.series),
    ...(event.markets ?? []).slice(0, 6).flatMap(m => [m.question, m.groupItemTitle]),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Auto-detect underlying asset from event data */
export function detectCrypto(event: PolymarketEvent): CryptoOption | null {
  const text = eventSearchText(event);
  if (/\b(bitcoin|btc)\b/.test(text)) return 'BTC';
  if (/\b(ethereum|eth)\b/.test(text)) return 'ETH';
  if (/\b(solana|sol)\b/.test(text)) return 'SOL';
  if (/\b(ripple|xrp)\b/.test(text)) return 'XRP';
  if (/\b(xauusd|xaut|gold|gc)\b/.test(text)) return 'XAUT';
  if (/\b(silver|xagusd|xag|si)\b/.test(text)) return 'SI';
  if (/\b(wti|crude oil|crude-oil|cl)\b/.test(text)) return 'WTI';
  if (/\b(spy|s&p 500|s & p 500|s and p 500)\b/.test(text)) return 'SPY';
  if (/\b(meta|meta platforms|facebook)\b/.test(text)) return 'META';
  if (/\b(openai|openai's valuation|openai valuation)\b/.test(text)) return 'OPENAI';

  return null;
}

/** Detect option type from event/market data */
export function detectOptionType(event: PolymarketEvent): OptionType {
  // Check series slug patterns
  const text = eventSearchText(event);
  if (text.includes('hit') || text.includes('reach') || text.includes('dip')) return 'hit';
  if (text.includes('above') || text.includes('below') || text.includes('strike')) return 'above';

  // Check market questions
  for (const market of (event.markets ?? [])) {
    const q = market.question.toLowerCase();
    if (q.includes('reach') || q.includes('dip') || q.includes('hit')) return 'hit';
    if (q.includes('above') || q.includes('below')) return 'above';
  }

  // Default to above
  return 'above';
}

/** Detect display type including 'price' (close-price) events */
export function detectEventDisplayType(event: PolymarketEvent): 'above' | 'hit' | 'price' {
  const eventSlug = (event.slug || '').toLowerCase();
  const text = eventSearchText(event);
  // 'price' events have the pattern "bitcoin-price-on-march-29" — slug contains "-price-on-"
  // Explicitly exclude hit-keyword slugs like "what-price-will-bitcoin-hit-..."
  const hasHitKeyword = text.includes('hit') || text.includes('reach') || text.includes('dip');
  if (
    !hasHitKeyword &&
    (eventSlug.includes('-price-on-') || eventSlug.startsWith('price-on-'))
  ) return 'price';
  return detectOptionType(event);
}

/** Format a Unix-seconds expiry timestamp as a short date string, e.g. "Mar 29" */
export function formatPolyExpiry(endDateSec: number): string {
  if (!endDateSec) return '';
  const d = new Date(endDateSec * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function extractSlugFromUrl(url: string): string | null {
  const regex = /^https?:\/\/(?:www\.)?polymarket\.com\/(?:[a-z]{2,3}\/)?event\/([a-zA-Z0-9-]+)\/?.*$/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

export function isValidPolymarketUrl(url: string): boolean {
  return extractSlugFromUrl(url) !== null;
}
