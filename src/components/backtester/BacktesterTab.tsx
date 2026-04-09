import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import {
  Box,
  Paper,
  Typography,
  Button,
  Fab,
  TextField,
  CircularProgress,
  Alert,

} from '@mui/material';
import Add from '@mui/icons-material/Add';
import SaveAlt from '@mui/icons-material/SaveAlt';
import Upload from '@mui/icons-material/Upload';
import Refresh from '@mui/icons-material/Refresh';
import type {
  BacktestPosition,
  CryptoOption,
} from '../../types';
import { BacktestChart } from './BacktestChart';
import { BacktestAddDialog } from './BacktestAddDialog';
import { BacktestPolymarketCard } from './BacktestPolymarketCard';
import { BacktestOptionCard } from './BacktestOptionCard';
import { BacktestFuturesCard } from './BacktestFuturesCard';
import { fetchPriceHistory, formatPolyExpiry } from '../../api/polymarket';
import { fetchDeribitCandles, fetchDeribitStrikes, resolveDeribitInstrument, fetchDeribitVolIndex, fetchDeribitTradesAsCandles } from '../../api/deribit';
import { parseBybitSymbol } from '../../api/bybit';
import { fetchBybitLibraryMidprice } from '../../api/bybit_library';
import { bsPrice, bsImpliedVol } from '../../pricing/engine';
import { fetchCryptoCandles, fetchCryptoPriceHistory } from '../../api/binance';
import type { OHLCCandle } from '../../api/binance';

const POSITION_COLORS = [
  '#4A90D9', '#22C55E', '#EF4444', '#FF8C00', '#A78BFA',
  '#F59E0B', '#EC4899', '#06B6D4', '#84CC16', '#6366F1',
];

export interface PnlPoint {
  timestamp: number;
  pnl: number;
}

export interface BacktestResult {
  position: BacktestPosition;
  pnlSeries: PnlPoint[];
  entryPrice?: number; // actual entry price used (for chart reference line)
  /** Cost basis in USD used to compute % P&L. */
  entryValue: number;
  source?: 'deribit' | 'bybit' | 'bybit-bs';
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toISOString().split('T')[0];
}

function parseDate(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

const MONTH_NAMES_BT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** Parse derived option fields from an instrument name like "BTC-3APR26-65000-C".
 *  Used as a fallback when the position was created before auto-population was added. */
function parseInstrumentFields(name: string): { optStrike: number; optExpiryMs: number; optType: 'Call' | 'Put' } | null {
  const n = name.replace(/-USDT$/, '');
  const m = n.match(/^(BTC|ETH)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/);
  if (!m) return null;
  const day = parseInt(m[2]);
  const monthIdx = MONTH_NAMES_BT.indexOf(m[3]);
  if (monthIdx === -1) return null;
  const year = 2000 + parseInt(m[4]);
  const strike = parseInt(m[5]);
  const expiryDate = new Date(Date.UTC(year, monthIdx, day, 8, 0, 0));
  return {
    optStrike: strike,
    optExpiryMs: expiryDate.getTime(),
    optType: m[6] === 'C' ? 'Call' : 'Put',
  };
}

type AddKind = 'polymarket' | 'deribit' | 'futures';

// A card group: polymarket cards can have multiple positions per card, others are 1:1
interface CardGroup {
  id: string;
  kind: AddKind;
  minimized: boolean;
}

export function BacktesterTab() {
  const [positions, setPositions] = useState<BacktestPosition[]>([]);
  const [cardGroups, setCardGroups] = useState<CardGroup[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Backtest range
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(formatDate(Math.floor(Date.now() / 1000)));
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Crypto overlay
  const [cryptoOverlay, setCryptoOverlay] = useState<'BTC' | 'ETH' | null>(null);
  const [cryptoCandles, setCryptoCandles] = useState<OHLCCandle[]>([]);
  const [candleInterval, setCandleInterval] = useState('1h');

  const uploadRef = useRef<HTMLInputElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Fetch crypto candles whenever overlay selection, interval, or results change
  useEffect(() => {
    if (!cryptoOverlay || results.length === 0) {
      setCryptoCandles([]);
      return;
    }
    let minTs = Infinity, maxTs = -Infinity;
    for (const r of results) {
      for (const pt of r.pnlSeries) {
        if (pt.timestamp < minTs) minTs = pt.timestamp;
        if (pt.timestamp > maxTs) maxTs = pt.timestamp;
      }
    }
    if (minTs === Infinity) return;
    fetchCryptoCandles(cryptoOverlay as 'BTC' | 'ETH', minTs, maxTs, candleInterval)
      .then(candles => setCryptoCandles(candles))
      .catch(() => {});
  }, [cryptoOverlay, results, candleInterval]);

  const colorFor = useCallback((idx: number) => POSITION_COLORS[idx % POSITION_COLORS.length], []);

  // Auto-scroll to newly added card
  useEffect(() => {
    if (scrollToId) {
      // Small timeout to let the DOM render
      const timer = setTimeout(() => {
        const el = cardRefs.current.get(scrollToId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setScrollToId(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToId]);

  // Add a new card
  const handleAddCard = useCallback((kind: AddKind) => {
    const id = generateId();
    setCardGroups(prev => [...prev, { id, kind, minimized: false }]);

    if (kind === 'deribit') {
      setPositions(prev => [...prev, {
        id,
        kind: 'deribit',
        label: 'Option',
        color: colorFor(prev.length),
        instrumentName: '',
        entryTimestamp: 0,
        entryPrice: 0,
        quantity: 0.01,
        enabledSources: ['deribit'],
      }]);
    } else if (kind === 'futures') {
      setPositions(prev => [...prev, {
        id,
        kind: 'futures',
        label: 'Long BTC futures',
        color: colorFor(prev.length),
        futuresSymbol: 'BTC',
        futuresSize: 0.001,
        entryTimestamp: 0,
        entryPrice: 0,
      }]);
    }
    // polymarket: positions are added by the card component via onUpdatePositions

    setScrollToId(id);
  }, [colorFor]);

  // Update a single position (for option/futures cards)
  const updatePosition = useCallback((id: string, patch: Partial<BacktestPosition>) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }, []);

  // Update all positions for a polymarket card group
  const handleUpdatePolyPositions = useCallback((groupId: string, newPositions: BacktestPosition[]) => {
    setPositions(prev => {
      // Remove old positions for this group, add new ones
      const others = prev.filter(p => !p.id.startsWith(groupId));
      // Assign IDs prefixed with groupId
      const tagged = newPositions.map((p, i) => ({
        ...p,
        id: `${groupId}-${i}`,
        color: colorFor(others.length + i),
      }));
      return [...others, ...tagged];
    });
  }, [colorFor]);

  // Remove a card group and its positions
  const handleRemoveCard = useCallback((groupId: string) => {
    setCardGroups(prev => prev.filter(g => g.id !== groupId));
    setPositions(prev => prev.filter(p => p.id !== groupId && !p.id.startsWith(`${groupId}-`)));
  }, []);

  // Toggle minimize
  const handleMinimize = useCallback((groupId: string) => {
    setCardGroups(prev => prev.map(g => g.id === groupId ? { ...g, minimized: !g.minimized } : g));
  }, []);

  // Rebuild card groups from a flat positions array (for file loads)
  const loadPositionsWithCards = useCallback((loaded: BacktestPosition[]) => {
    const groups: CardGroup[] = [];
    const finalPositions: BacktestPosition[] = [];

    // Group polymarket positions by eventSlug; others get 1:1 cards
    const polyBySlug = new Map<string, BacktestPosition[]>();
    for (const pos of loaded) {
      if (pos.kind === 'polymarket') {
        const key = pos.polyEventSlug || pos.id;
        if (!polyBySlug.has(key)) polyBySlug.set(key, []);
        polyBySlug.get(key)!.push(pos);
      } else {
        const groupId = pos.id;
        groups.push({ id: groupId, kind: pos.kind as AddKind, minimized: true });
        finalPositions.push({ ...pos, id: groupId });
      }
    }

    for (const [, polyPositions] of polyBySlug) {
      const groupId = generateId();
      groups.push({ id: groupId, kind: 'polymarket', minimized: true });
      polyPositions.forEach((p, i) => {
        finalPositions.push({ ...p, id: `${groupId}-${i}` });
      });
    }

    setCardGroups(groups);
    setPositions(finalPositions);
  }, []);

  const handleSave = useCallback(async () => {
    const dateStr = new Date().toISOString().slice(0, 10);

    // Convert BacktestPosition[] → builder_full_save cards for cross-section compatibility
    // Group polymarket positions by eventSlug into one card each; others get 1:1 cards
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cards: any[] = [];
    const polyBySlug = new Map<string, BacktestPosition[]>();
    for (const pos of positions) {
      if (pos.kind === 'polymarket') {
        const key = pos.polyEventSlug || pos.id;
        if (!polyBySlug.has(key)) polyBySlug.set(key, []);
        polyBySlug.get(key)!.push(pos);
      } else if (pos.kind === 'deribit') {
        cards.push({
          id: pos.id,
          kind: 'options',
          data: {
            chain: null,
            selectedOptions: [{
              symbol: (pos.instrumentName ?? '').replace(/-USDT$/, ''),
              optionsType: pos.optType ?? 'Call',
              strike: pos.optStrike ?? 0,
              expiryTimestamp: pos.optExpiryMs ?? 0,
              side: (pos.quantity ?? 0) >= 0 ? 'buy' : 'sell',
              quantity: Math.abs(pos.quantity ?? 0.01),
              entryPrice: pos.entryPrice,
              markIv: 0,
            }],
            minimized: false,
          },
        });
      } else if (pos.kind === 'futures') {
        cards.push({
          id: pos.id,
          kind: 'futures',
          data: {
            symbol: `${pos.futuresSymbol ?? 'BTC'}USDT`,
            entryPrice: pos.entryPrice,
            size: pos.futuresSize ?? 0.001,
            leverage: 5,
            minimized: false,
          },
        });
      }
    }
    for (const [slug, polyPositions] of polyBySlug) {
      cards.push({
        id: `poly-${slug}`,
        kind: 'polymarket',
        data: {
          event: null,
          optionType: 'above',
          crypto: null,
          markets: [],
          selections: polyPositions.map(p => ({
            marketId: p.tokenId ?? '',
            side: p.polySide ?? 'YES',
            quantity: p.quantity ?? 100,
            entryPrice: p.entryPrice,
          })),
          minimized: false,
          polyEventSlug: slug,
        },
      });
    }

    const payload = {
      kind: 'builder_full_save',
      cards,
      backtestPositions: positions, // preserve full backtest data for lossless reload
    };
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonA = document.createElement('a');
    jsonA.href = jsonUrl;
    jsonA.download = `backtest_${dateStr}.json`;
    jsonA.click();
    URL.revokeObjectURL(jsonUrl);

    if (chartRef.current) {
      const canvas = await html2canvas(chartRef.current, { useCORS: true, scale: 2 });
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backtest_chart_${dateStr}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    }
  }, [positions]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (Array.isArray(parsed)) {
          // Backtester save format: BacktestPosition[]
          loadPositionsWithCards(parsed.map((p: BacktestPosition, i: number) => ({ ...p, color: p.color || colorFor(i) })));
        } else if (parsed?.kind === 'builder_full_save' && Array.isArray(parsed.backtestPositions)) {
          // Backtester save with lossless backtestPositions — reload directly
          loadPositionsWithCards(parsed.backtestPositions.map((p: BacktestPosition, i: number) => ({ ...p, color: p.color || colorFor(i) })));
        } else if (parsed?.kind === 'builder_full_save' && Array.isArray(parsed.cards)) {
          // Full Position Builder save — extract positions for backtesting
          const imported: BacktestPosition[] = [];
          let idx = 0;
          for (const card of parsed.cards) {
            if (card.kind === 'polymarket') {
              const cardOptType: string = card.data?.optionType ?? '';
              for (const sel of (card.data?.selections ?? [])) {
                const market = (card.data?.markets ?? []).find((m: { id: string }) => m.id === sel.marketId);
                if (!market) continue;
                const tokenId = sel.side === 'YES' ? market.yesTokenId : market.noTokenId;
                const expiry = market.endDate ? ` · exp ${formatPolyExpiry(market.endDate)}` : '';
                const typePart = cardOptType ? ` · ${cardOptType}` : '';
                imported.push({
                  id: generateId(), kind: 'polymarket',
                  label: `${sel.side} ${market.groupItemTitle || String(market.strikePrice)}${typePart}${expiry}`,
                  color: colorFor(idx++), tokenId, polySide: sel.side,
                  quantity: sel.quantity, entryTimestamp: 0, entryPrice: 0,
                  polyEventSlug: card.data?.event?.slug,
                });
              }
            } else if (card.kind === 'options') {
              for (const opt of (card.data?.selectedOptions ?? [])) {
                imported.push({
                  id: generateId(), kind: 'deribit',
                  label: `${opt.side === 'buy' ? 'Buy' : 'Sell'} ${opt.symbol}`,
                  color: colorFor(idx++), instrumentName: opt.symbol,
                  quantity: Math.abs(opt.quantity) * (opt.side === 'sell' ? -1 : 1),
                  entryTimestamp: 0, entryPrice: opt.entryPrice,
                  optStrike: opt.strike,
                  optExpiryMs: opt.expiryTimestamp,
                  optType: opt.optionsType,
                });
              }
            } else if (card.kind === 'futures') {
              const sym = (card.data?.symbol ?? '').toUpperCase();
              const asset = sym.startsWith('ETH') ? 'ETH' : sym.startsWith('SOL') ? 'SOL' : sym.startsWith('XRP') ? 'XRP' : 'BTC';
              imported.push({
                id: generateId(), kind: 'futures',
                label: `${(card.data?.size ?? 0) >= 0 ? 'Long' : 'Short'} ${asset} futures`,
                color: colorFor(idx++), futuresSymbol: asset,
                futuresSize: card.data?.size ?? 0,
                entryTimestamp: 0, entryPrice: card.data?.entryPrice ?? 0,
              });
            }
          }
          if (imported.length > 0) loadPositionsWithCards(imported);
        } else if (parsed?.kind === 'builder_snapshot') {
          // Position Builder snapshot format
          const imported: BacktestPosition[] = [];
          let idx = 0;
          for (const p of (parsed.polyPositions ?? [])) {
            imported.push({
              id: generateId(), kind: 'polymarket',
              label: p.label, color: colorFor(idx++),
              tokenId: p.tokenId, polySide: p.side,
              quantity: p.quantity, entryTimestamp: 0, entryPrice: 0,
            });
          }
          for (const o of (parsed.optionPositions ?? [])) {
            // Bybit option symbols (BTC-28MAR25-100000-C) match Deribit format exactly
            imported.push({
              id: generateId(), kind: 'deribit',
              label: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.symbol}`,
              color: colorFor(idx++),
              instrumentName: o.symbol,
              quantity: Math.abs(o.quantity) * (o.side === 'sell' ? -1 : 1),
              entryTimestamp: 0, entryPrice: o.entryPrice,
            });
          }
          for (const f of (parsed.futuresPositions ?? [])) {
            imported.push({
              id: generateId(), kind: 'futures',
              label: `${f.size >= 0 ? 'Long' : 'Short'} ${f.asset} futures`,
              color: colorFor(idx++),
              futuresSymbol: f.asset, futuresSize: f.size,
              entryTimestamp: 0, entryPrice: f.entryPrice,
            });
          }
          if (imported.length > 0) loadPositionsWithCards(imported);
        } else if (parsed?.version === 'position_hedger_snapshot_v1') {
          // Old position_hedger snapshot format
          const imported: BacktestPosition[] = [];
          let idx = 0;
          for (const sel of (parsed.polySelections ?? [])) {
            const market = (parsed.polyMarkets ?? []).find((m: { id: string }) => m.id === sel.marketId);
            if (!market) continue;
            const tokenId = sel.side === 'YES' ? market.yesTokenId : market.noTokenId;
            const expiry = market.endDate ? ` · exp ${formatPolyExpiry(market.endDate)}` : '';
            imported.push({
              id: generateId(), kind: 'polymarket',
              label: `${sel.side} ${market.groupItemTitle || String(market.strikePrice)}${expiry}`,
              color: colorFor(idx++), tokenId, polySide: sel.side,
              quantity: sel.quantity, entryTimestamp: 0, entryPrice: 0,
              polyEventSlug: parsed.polyEvent?.slug,
            });
          }
          for (const sel of (parsed.bybitSelections ?? [])) {
            const symbol = sel.symbol as string;
            const parsedSym = parseBybitSymbol(symbol);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chainTickers = (parsed.bybitChain?.tickers ?? []) as any[];
            const ticker = chainTickers.find((t: { symbol: string }) => t.symbol === symbol);
            const markIv = ticker ? parseFloat(String(ticker.markIv)) || 0 : 0;
            const askPrice = ticker ? parseFloat(String(ticker.ask1Price)) || 0 : 0;
            const bidPrice = ticker ? parseFloat(String(ticker.bid1Price)) || 0 : 0;
            const entryPrice = sel.side === 'buy' ? askPrice : bidPrice;
            imported.push({
              id: generateId(), kind: 'deribit',
              label: `${sel.side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`,
              color: colorFor(idx++),
              instrumentName: symbol,
              quantity: Math.abs(sel.quantity) * (sel.side === 'sell' ? -1 : 1),
              entryTimestamp: 0, entryPrice,
              optStrike: parsedSym?.strike,
              optExpiryMs: parsed.bybitChain?.expiryTimestamp as number | undefined,
              optType: parsedSym?.optionsType,
            });
          }
          if (imported.length > 0) loadPositionsWithCards(imported);
        }
      } catch { /* ignore bad JSON */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [colorFor, loadPositionsWithCards]);

  // ---- Run backtest ----

  const handleRunBacktest = useCallback(async () => {
    if (positions.length === 0) return;
    const startTs = startDate ? parseDate(startDate) : Math.floor(Date.now() / 1000) - 90 * 86400;
    const endTs = endDate ? parseDate(endDate) : Math.floor(Date.now() / 1000);

    setRunning(true);
    setError(null);
    setWarnings([]);

    try {
      const newResults: BacktestResult[] = [];
      const localWarnings: string[] = [];

      // Pre-fetch Binance spot data for futures
      const futuresSymbols = [...new Set(
        positions.filter(p => p.kind === 'futures' && p.futuresSymbol).map(p => p.futuresSymbol as CryptoOption)
      )];
      const spotHistories = new Map<string, { t: number; p: number }[]>();
      for (const sym of futuresSymbols) {
        const pts = await fetchCryptoPriceHistory(sym, startTs, endTs);
        spotHistories.set(sym, pts);
      }

      // Pre-fetch DVOL once per run before option candle fetches to avoid hitting
      // Deribit rate limits mid-run (candle fetches come after and may get 429'd,
      // but DVOL fetched first on a fresh rate-limit window usually succeeds).
      const hasOptions = positions.some(p => p.kind === 'deribit');
      const hasBtcOpts = positions.some(p => p.kind === 'deribit' && !p.instrumentName?.startsWith('ETH'));
      const hasEthOpts = positions.some(p => p.kind === 'deribit' && p.instrumentName?.startsWith('ETH'));
      const prefetchedDvol = new Map<'BTC' | 'ETH', Map<number, number>>();
      if (hasOptions) {
        if (hasBtcOpts) prefetchedDvol.set('BTC', await fetchDeribitVolIndex('BTC', startTs * 1000, endTs * 1000));
        if (hasEthOpts) prefetchedDvol.set('ETH', await fetchDeribitVolIndex('ETH', startTs * 1000, endTs * 1000));
      }

      for (const pos of positions) {
        if (pos.kind === 'polymarket' && pos.tokenId) {
          const histData = await fetchPriceHistory(pos.tokenId, '1', 10);
          const rawHistory = (histData.history ?? []).filter(pt => pt.t >= startTs && pt.t <= endTs);
          // Skip leading zeros — Polymarket returns price 0 for timestamps before the market existed
          const firstNonZeroIdx = rawHistory.findIndex(pt => pt.p > 0);
          const history = firstNonZeroIdx >= 0 ? rawHistory.slice(firstNonZeroIdx) : rawHistory;
          if (history.length === 0) {
            newResults.push({ position: pos, pnlSeries: [], entryValue: 0 });
            continue;
          }
          // Use first visible (non-zero) point as baseline so the line starts at $0 on the graph
          const entryPrice = history[0].p;
          const qty = pos.quantity ?? 100;
          const pnlSeries: PnlPoint[] = history.map(pt => ({
            timestamp: pt.t,
            pnl: (pt.p - entryPrice) * qty,
          }));
          newResults.push({ position: pos, pnlSeries, entryValue: entryPrice * Math.abs(qty) });

        } else if (pos.kind === 'deribit' && pos.instrumentName) {
          const baseName = pos.instrumentName.replace(/-USDT$/, '');
          const sources = ['deribit', 'bybit', 'bybit-bs'] as const;
          const sourceLabels: Record<string, string> = { deribit: 'Deribit', bybit: 'Bybit', 'bybit-bs': 'BS' };
          const qty = pos.quantity ?? 0.01;
          // Caches Deribit raw candles (BTC-denominated) so Bybit BS can reuse them
          // without a second API call — populated in the 'deribit' source block below.
          let cachedDeribitCandles: { timestamp: number; close: number }[] = [];

          for (const source of sources) {
            const resultId = `${pos.id}_${source}`;
            // If derived fields are missing (card pre-dates auto-population), parse from instrument name
            const parsedFields = (pos.optStrike == null || pos.optExpiryMs == null || !pos.optType)
              ? parseInstrumentFields(baseName)
              : null;
            const effectivePos = parsedFields ? { ...pos, ...parsedFields } : pos;
            const syntheticPos = { ...effectivePos, id: resultId, label: `${baseName} (${sourceLabels[source]})` };

            if (source === 'deribit') {
              // Deribit: real mark-price candles (BTC-denominated) converted to USD.
              // Try exact name first — avoids the heavy get_instruments call (reduces 429 risk).
              let resolvedName = baseName;
              let deribitCandles: { timestamp: number; close: number }[] = [];
              let deribitFetchError: string | null = null;

              try {
                deribitCandles = await fetchDeribitCandles(baseName, startTs * 1000, endTs * 1000, 60);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes('(404)') || msg.includes('not found on Deribit')) {
                  try {
                    const resolved = await resolveDeribitInstrument(baseName);
                    resolvedName = resolved.instrumentName;
                    if (!resolved.exactMatch) {
                      localWarnings.push(`Deribit: exact strike not listed — using nearest available ${resolvedName} instead of ${baseName}`);
                    }
                    deribitCandles = await fetchDeribitCandles(resolvedName, startTs * 1000, endTs * 1000, 60);
                  } catch (e2) {
                    deribitFetchError = e2 instanceof Error ? e2.message : String(e2);
                  }
                } else {
                  deribitFetchError = msg;
                }
              }

              // If the full range returned nothing, probe the last 30 days.
              // Weekly options are listed only 7–14 days before expiry; monthly options
              // have data, but deeply ITM/OTM strikes may be illiquid.
              if (!deribitFetchError && deribitCandles.length === 0) {
                const probeStartMs = endTs * 1000 - 30 * 24 * 3600 * 1000;
                if (probeStartMs > startTs * 1000) { // only if probe window is smaller than original
                  try {
                    const probeCandles = await fetchDeribitCandles(resolvedName, probeStartMs, endTs * 1000, 60);
                    if (probeCandles.length > 0) {
                      deribitCandles = probeCandles;
                      localWarnings.push(`Deribit: ${resolvedName} — data available from ${formatDate(Math.floor(probeCandles[0].timestamp / 1000))} (recently listed; backtest range trimmed to available data).`);
                    }
                  } catch { /* ignore — keep deribitCandles empty */ }
                }
              }

              // Still empty — strike may be deeply ITM/OTM with no Deribit mark-price history.
              // Try the nearest listed strike of the same type (C/P) and expiry.
              if (!deribitFetchError && deribitCandles.length === 0) {
                const nm = resolvedName.match(/^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-([CP])$/);
                if (nm) {
                  try {
                    const allStrikes = await fetchDeribitStrikes(nm[1] as 'BTC' | 'ETH', nm[2], true);
                    const reqStrike = parseInt(nm[3]);
                    const nearest = allStrikes
                      .filter(s => s !== reqStrike)
                      .reduce((a, b) => Math.abs(a - reqStrike) < Math.abs(b - reqStrike) ? a : b, Infinity);
                    if (isFinite(nearest)) {
                      const nearName = `${nm[1]}-${nm[2]}-${nearest}-${nm[4]}`;
                      const nearStart = Math.max(startTs * 1000, endTs * 1000 - 30 * 24 * 3600 * 1000);
                      const nearCandles = await fetchDeribitCandles(nearName, nearStart, endTs * 1000, 60);
                      if (nearCandles.length > 0) {
                        deribitCandles = nearCandles;
                        resolvedName = nearName;
                        localWarnings.push(`Deribit: ${baseName} has no mark-price history (deeply ITM/OTM, illiquid). Using nearest listed strike ${resolvedName} as proxy.`);
                      }
                    }
                  } catch { /* ignore */ }
                }
              }

              // Still empty — try synthesizing candles from actual trade records.
              // Short-dated daily/weekly options often lack TradingView chart data but do have trades.
              if (!deribitFetchError && deribitCandles.length === 0) {
                try {
                  const tradeCandles = await fetchDeribitTradesAsCandles(resolvedName, startTs * 1000, endTs * 1000);
                  if (tradeCandles.length > 0) {
                    deribitCandles = tradeCandles;
                    localWarnings.push(`Deribit: ${resolvedName} — no mark-price history; synthesized ${tradeCandles.length} hourly candles from trade records.`);
                  }
                } catch { /* ignore */ }
              }

              if (deribitFetchError) {
                // 429 is a rate-limit, not a missing instrument — show different message
                if (deribitFetchError.includes('429') || deribitFetchError.toLowerCase().includes('rate_limited') || deribitFetchError.includes('10028')) {
                  localWarnings.push(`Deribit: rate limited for ${resolvedName}. Click Refresh to retry.`);
                } else {
                let strikeHint = '';
                if (deribitFetchError.includes('(404)') || deribitFetchError.includes('not found on Deribit')) {
                  const match = resolvedName.match(/^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-[CP]$/);
                  if (match) {
                    try {
                      const strikes = await fetchDeribitStrikes(match[1] as 'BTC' | 'ETH', match[2], true);
                      if (strikes.length > 0) {
                        const target = parseInt(match[3]);
                        const nearest = strikes.reduce((a, b) => Math.abs(a - target) < Math.abs(b - target) ? a : b);
                        strikeHint = ` Nearest available Deribit strike: $${nearest.toLocaleString()}.`;
                      } else {
                        strikeHint = ` No ${match[1]} options for ${match[2]} found on Deribit.`;
                      }
                    } catch { /* ignore */ }
                  }
                }
                localWarnings.push(`Deribit: ${resolvedName} not available.${strikeHint} (${deribitFetchError})`);
                }
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
              } else if (deribitCandles.length > 0) {
                cachedDeribitCandles = deribitCandles; // share with Bybit BS block
                if (!spotHistories.has('BTC')) {
                  spotHistories.set('BTC', await fetchCryptoPriceHistory('BTC', startTs, endTs));
                }
                const btcSpot = spotHistories.get('BTC') ?? [];
                if (btcSpot.length === 0) {
                  localWarnings.push(`BTC/USD spot history unavailable for Deribit ${baseName}`);
                  newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                } else {
                  const usdCandles = deribitCandles.map(c => {
                    const cTs = Math.floor(c.timestamp / 1000);
                    const spot = btcSpot.reduce((best, pt) =>
                      Math.abs(pt.t - cTs) < Math.abs(best.t - cTs) ? pt : best);
                    return { timestamp: c.timestamp, close: c.close * spot.p };
                  });
                  const entryPrice = usdCandles[0].close;
                  newResults.push({ position: syntheticPos, entryValue: entryPrice * Math.abs(qty), source, pnlSeries: usdCandles.map(c => ({
                    timestamp: Math.floor(c.timestamp / 1000),
                    pnl: (c.close - entryPrice) * qty,
                  })) });
                }
              } else {
                localWarnings.push(`Deribit: no mark-price or trade history for ${resolvedName} in this date range (typical for illiquid/short-dated options). BS reconstruction (purple dashed line) is shown instead.`);
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
              }

            } else if (source === 'bybit') {
              // Bybit: real midprice data from the local Parquet library (api_server.py).
              // Instrument name format: BTC-10APR26-67500-C  (our library uses same convention)
              const nm = baseName.match(/^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-([CP])$/);
              if (!nm) {
                localWarnings.push(`Bybit library: cannot parse instrument name "${baseName}". Expected BTC-10APR26-67500-C.`);
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
              } else {
                const libExpiry     = nm[2];                              // e.g. "10APR26"
                const libStrike     = parseInt(nm[3]);                    // e.g. 67500
                const libOptionType = nm[4] as 'C' | 'P';
                const dateFrom      = formatDate(startTs);
                const dateTo        = formatDate(endTs);
                try {
                  const candles = await fetchBybitLibraryMidprice(
                    libExpiry, libStrike, libOptionType, dateFrom, dateTo, '1h'
                  );
                  if (candles.length === 0) {
                    localWarnings.push(
                      `Bybit library: no data for ${baseName} between ${dateFrom} and ${dateTo}. ` +
                      `Add the date to the library via the options data tool.`
                    );
                    newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                  } else {
                    const entryPrice = candles[0].close;
                    newResults.push({
                      position: syntheticPos,
                      entryValue: entryPrice * Math.abs(qty),
                      source,
                      pnlSeries: candles.map(c => ({
                        timestamp: Math.floor(c.timestamp / 1000),
                        pnl: (c.close - entryPrice) * qty,
                      })),
                    });
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (msg.includes('not reachable')) {
                    localWarnings.push(`Bybit library: server not running — start with: python btc-options-lib/api_server.py`);
                  } else {
                    localWarnings.push(`Bybit library: ${msg}`);
                  }
                  newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                }
              }

            } else if (source === 'bybit-bs') {
              // Bybit BS: BS reconstruction with strike-specific time-varying IV.
              // Priority: (1) IV derived from Deribit mark prices via bsImpliedVol,
              //           (2) Deribit DVOL (ATM 30-day proxy),
              //           (3) manual Entry IV % from the option card.
              if (effectivePos.optStrike == null || effectivePos.optExpiryMs == null || !effectivePos.optType) {
                localWarnings.push(`Bybit BS: ${baseName} — could not parse optStrike/optExpiryMs. Use format BTC-28MAR25-100000-C.`);
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                continue;
              }

              if (!spotHistories.has('BTC')) {
                spotHistories.set('BTC', await fetchCryptoPriceHistory('BTC', startTs, endTs));
              }
              const YEAR_SEC = 365.25 * 24 * 3600;
              const filtered = (spotHistories.get('BTC') ?? []).filter(pt => pt.t >= startTs && pt.t <= endTs);
              if (filtered.length === 0) {
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                continue;
              }

              const firstSpot = filtered[0].p;
              const firstTau = Math.max((effectivePos.optExpiryMs / 1000 - filtered[0].t) / YEAR_SEC, 0);

              // ── Option A: derive IV from Deribit mark prices ──────────────────
              // When Deribit candles are available, invert BS at each 60-min candle to get
              // the true strike-specific IV at that timestamp. This produces a Bybit BS line
              // that closely tracks real Deribit prices (BS reconstructed from actual IV).
              if (cachedDeribitCandles.length > 0) {
                const btcSpot = spotHistories.get('BTC') ?? [];
                // Derive IV at each Deribit candle timestamp
                const ivEntries: { tSec: number; iv: number }[] = [];
                for (const c of cachedDeribitCandles) {
                  const cTs = Math.floor(c.timestamp / 1000);
                  const spot = btcSpot.reduce((best, pt) =>
                    Math.abs(pt.t - cTs) < Math.abs(best.t - cTs) ? pt : best);
                  if (!spot) continue;
                  const cTau = Math.max((effectivePos.optExpiryMs! / 1000 - cTs) / YEAR_SEC, 0);
                  // Skip final hour — near-expiry vega ≈ 0 makes IV unstable
                  if (cTau < 1 / (365.25 * 24)) continue;
                  const iv = bsImpliedVol(spot.p, effectivePos.optStrike!, cTau, c.close * spot.p, effectivePos.optType!);
                  if (iv != null) ivEntries.push({ tSec: cTs, iv });
                }

                if (ivEntries.length > 0) {
                  // For each 5-min spot point, find nearest Deribit-derived IV
                  const getIvFromDeribit = (tSec: number): number => {
                    let best = ivEntries[0];
                    for (const e of ivEntries) {
                      if (Math.abs(e.tSec - tSec) < Math.abs(best.tSec - tSec)) best = e;
                    }
                    return best.iv;
                  };
                  const firstIvD = getIvFromDeribit(filtered[0].t);
                  const entryPriceD = bsPrice(firstSpot, effectivePos.optStrike!, firstIvD, firstTau, effectivePos.optType!);
                  localWarnings.push(`Bybit BS: ${baseName} — Deribit-derived IV (strike-specific, time-varying). Entry IV: ${(firstIvD * 100).toFixed(1)}%.`);
                  newResults.push({ position: syntheticPos, entryValue: entryPriceD * Math.abs(qty), source, pnlSeries: filtered.map(pt => {
                    const tau = Math.max((effectivePos.optExpiryMs! / 1000 - pt.t) / YEAR_SEC, 0);
                    return { timestamp: pt.t, pnl: (bsPrice(pt.p, effectivePos.optStrike!, getIvFromDeribit(pt.t), tau, effectivePos.optType!) - entryPriceD) * qty };
                  }) });
                  continue;
                }
              }

              // ── Fallback: DVOL-scaled Bybit IV > raw DVOL ────────────────────
              // When Deribit candles are unavailable, scale the live Bybit IV (strike-specific)
              // by the DVOL ratio to get a time-varying, strike-aware IV estimate.
              // e.g. if today's DVOL=55% and liveBybitIV=62%, and yesterday's DVOL=58%,
              // then yesterday's estimate = 62% × (58% / 55%) = 65.4% — captures vol regime.
              const currency = baseName.startsWith('ETH') ? 'ETH' : 'BTC';
              const dvolMap = prefetchedDvol.get(currency) ?? new Map<number, number>();
              const hasDvol = dvolMap.size > 0;

              const getIv = (tSec: number): number | null => {
                const bucket = Math.floor(tSec / 3600) * 3600;
                if (hasDvol) {
                  const v = dvolMap.get(bucket) ?? dvolMap.get(bucket - 3600);
                  if (v != null) return v;
                }
                return null;
              };

              const firstIv = getIv(filtered[0].t);
              if (firstIv == null) {
                localWarnings.push(`BS: ${baseName} — no IV available (DVOL fetch failed).`);
                newResults.push({ position: syntheticPos, pnlSeries: [], entryValue: 0, source });
                continue;
              }

              const entryPrice = bsPrice(firstSpot, effectivePos.optStrike!, firstIv, firstTau, effectivePos.optType!);
              localWarnings.push(`BS: ${baseName} — DVOL as time-varying IV. Entry IV: ${(firstIv * 100).toFixed(1)}%.`);
              newResults.push({ position: syntheticPos, entryValue: entryPrice * Math.abs(qty), source, pnlSeries: filtered.map(pt => {
                const tau = Math.max((effectivePos.optExpiryMs! / 1000 - pt.t) / YEAR_SEC, 0);
                const iv = getIv(pt.t) ?? firstIv;
                return { timestamp: pt.t, pnl: (bsPrice(pt.p, effectivePos.optStrike!, iv, tau, effectivePos.optType!) - entryPrice) * qty };
              }) });
            }
          } // end for source

        } else if (pos.kind === 'futures' && pos.futuresSymbol && pos.futuresSize != null) {
          const spotPts = (spotHistories.get(pos.futuresSymbol) ?? []).filter(pt => pt.t >= startTs && pt.t <= endTs);
          if (spotPts.length === 0) {
            newResults.push({ position: pos, pnlSeries: [], entryValue: 0 });
            continue;
          }
          const entryPrice = spotPts[0].p;
          const pnlSeries: PnlPoint[] = spotPts.map(pt => ({
            timestamp: pt.t,
            pnl: (pt.p - entryPrice) * pos.futuresSize!,
          }));
          newResults.push({ position: pos, pnlSeries, entryPrice, entryValue: entryPrice * Math.abs(pos.futuresSize!) });
        }
      }

      setWarnings(localWarnings);
      setResults(newResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  }, [positions, startDate, endDate]);

  const timeRange = useMemo(() => {
    const startTs = startDate ? parseDate(startDate) : Math.floor(Date.now() / 1000) - 90 * 86400;
    const endTs = endDate ? parseDate(endDate) : Math.floor(Date.now() / 1000);
    return { startTs, endTs };
  }, [startDate, endDate]);

  // Compute position index offset per card group (for coloring polymarket legs)
  const cardPositionIndex = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const group of cardGroups) {
      map.set(group.id, idx);
      const count = positions.filter(p => p.id === group.id || p.id.startsWith(`${group.id}-`)).length;
      idx += Math.max(count, 1);
    }
    return map;
  }, [cardGroups, positions]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top toolbar: Refresh / Load / Save */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
        <input ref={uploadRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleUpload} />
        <Button size="small" variant="outlined" startIcon={running ? <CircularProgress size={14} /> : <Refresh />} onClick={handleRunBacktest} disabled={positions.length === 0 || running}>
          Refresh
        </Button>
        <Button size="small" variant="outlined" startIcon={<Upload />} onClick={() => uploadRef.current?.click()}>
          Load
        </Button>
        <Button size="small" variant="outlined" startIcon={<SaveAlt />} onClick={handleSave} disabled={positions.length === 0}>
          Save
        </Button>
      </Box>

      {/* Chart */}
      {results.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <div ref={chartRef}>
            <BacktestChart
              results={results}
              startTimestamp={timeRange.startTs}
              endTimestamp={timeRange.endTs}
              cryptoOverlay={cryptoOverlay}
              onCryptoOverlayChange={setCryptoOverlay}
              cryptoCandles={cryptoCandles}
              candleInterval={candleInterval}
              onCandleIntervalChange={setCandleInterval}
            />
          </div>
        </Paper>
      )}

      {/* Position cards */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6" fontWeight={600}>Positions</Typography>
        </Box>
        {cardGroups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No positions yet. Click + to add.</Typography>
        ) : (
          cardGroups.map(group => {
            const refCallback = (el: HTMLDivElement | null) => {
              if (el) cardRefs.current.set(group.id, el);
              else cardRefs.current.delete(group.id);
            };
            if (group.kind === 'polymarket') {
              const groupPositions = positions.filter(p => p.id.startsWith(`${group.id}-`));
              return (
                <div key={group.id} ref={refCallback}>
                  <BacktestPolymarketCard
                    groupId={group.id}
                    positions={groupPositions}
                    onUpdatePositions={handleUpdatePolyPositions}
                    onRemove={handleRemoveCard}
                    onMinimize={handleMinimize}
                    minimized={group.minimized}
                    colorFor={colorFor}
                    startIndex={cardPositionIndex.get(group.id) ?? 0}
                  />
                </div>
              );
            }
            if (group.kind === 'deribit') {
              const pos = positions.find(p => p.id === group.id);
              if (!pos) return null;
              return (
                <div key={group.id} ref={refCallback}>
                  <BacktestOptionCard
                    id={group.id}
                    position={pos}
                    onUpdate={updatePosition}
                    onRemove={handleRemoveCard}
                    onMinimize={handleMinimize}
                    minimized={group.minimized}
                  />
                </div>
              );
            }
            // futures
            const pos = positions.find(p => p.id === group.id);
            if (!pos) return null;
            return (
              <div key={group.id} ref={refCallback}>
                <BacktestFuturesCard
                  id={group.id}
                  position={pos}
                  onUpdate={updatePosition}
                  onRemove={handleRemoveCard}
                  onMinimize={handleMinimize}
                  minimized={group.minimized}
                />
              </div>
            );
          })
        )}
      </Box>

      {/* Controls bar */}
      <Paper sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label="Start Date"
          type="date"
          size="small"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 180 }}
          helperText="Leave empty for max history"
        />
        <TextField
          label="End Date"
          type="date"
          size="small"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 180 }}
        />
        <Button
          variant="contained"
          onClick={handleRunBacktest}
          disabled={positions.length === 0 || running}
          startIcon={running ? <CircularProgress size={16} /> : undefined}
        >
          {running ? 'Running\u2026' : 'Run Backtest'}
        </Button>
        {error && <Alert severity="error" sx={{ flex: 1 }}>{error}</Alert>}
        {warnings.map((w, i) => (
          <Alert key={i} severity="warning" sx={{ flex: 1 }}>{w}</Alert>
        ))}
      </Paper>

      {/* Floating add button */}
      <Fab color="primary" onClick={() => setAddDialogOpen(true)} sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100 }}>
        <Add />
      </Fab>

      {/* Add position dialog */}
      <BacktestAddDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={handleAddCard}
      />
    </Box>
  );
}
