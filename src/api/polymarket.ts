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
  series?: { cgAssetName?: string };
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

/** Parse strike price from groupItemTitle like "↑$100,000" or "$95,000" */
export function parseStrikePrice(title: string): number {
  // Remove arrows, dollar signs, commas, whitespace
  const cleaned = title.replace(/[↑↓$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseOptionalPrice(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined;
  const v = typeof raw === 'string' ? parseFloat(raw) : raw;
  return isFinite(v) && v > 0 && v < 1 ? v : undefined;
}

export function parseMarkets(markets: PolymarketEvent['markets']): ParsedMarket[] {
  return markets.map((market) => {
    const tokenIds = JSON.parse(market.clobTokenIds) as string[];
    let currentPrice = 0;
    try {
      const prices = JSON.parse(market.outcomePrices) as string[];
      currentPrice = parseFloat(prices[0]); // YES price (mid)
    } catch {
      currentPrice = 0;
    }
    return {
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
    };
  });
}

/** Auto-detect crypto asset from event data */
export function detectCrypto(event: PolymarketEvent): CryptoOption | null {
  // Check series.cgAssetName first
  const cgAsset = (event.series?.cgAssetName || '').toLowerCase();
  if (cgAsset === 'bitcoin' || cgAsset === 'btc') return 'BTC';
  if (cgAsset === 'ethereum' || cgAsset === 'eth') return 'ETH';
  if (cgAsset === 'solana' || cgAsset === 'sol') return 'SOL';
  if (cgAsset === 'ripple' || cgAsset === 'xrp') return 'XRP';

  // Check series slug
  const slug = (event.series?.seriesSlug || '').toLowerCase();
  if (slug.includes('btc') || slug.includes('bitcoin')) return 'BTC';
  if (slug.includes('eth') || slug.includes('ethereum')) return 'ETH';
  if (slug.includes('sol') || slug.includes('solana')) return 'SOL';
  if (slug.includes('xrp') || slug.includes('ripple')) return 'XRP';

  // Parse event title
  const title = event.title.toLowerCase();
  if (title.includes('bitcoin') || title.includes('btc')) return 'BTC';
  if (title.includes('ethereum') || title.includes('eth')) return 'ETH';
  if (title.includes('solana') || title.includes('sol')) return 'SOL';
  if (title.includes('xrp') || title.includes('ripple')) return 'XRP';

  return null;
}

/** Detect option type from event/market data */
export function detectOptionType(event: PolymarketEvent): OptionType {
  // Check series slug patterns
  const slug = (event.series?.seriesSlug || '').toLowerCase();
  if (slug.includes('hit') || slug.includes('reach') || slug.includes('dip')) return 'hit';
  if (slug.includes('above') || slug.includes('strike')) return 'above';

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
  // 'price' events have the pattern "bitcoin-price-on-march-29" — slug contains "-price-on-"
  // Explicitly exclude hit-keyword slugs like "what-price-will-bitcoin-hit-..."
  const hasHitKeyword = eventSlug.includes('hit') || eventSlug.includes('reach') || eventSlug.includes('dip');
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
