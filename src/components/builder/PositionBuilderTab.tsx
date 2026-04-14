import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toBlob as elementToBlob } from 'html-to-image';
import {
  Alert,
  Box,
  Chip,
  Divider,
  Fab,
  Paper,
  Typography,
  Slider,
  TextField,
  Button,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import SaveAlt from '@mui/icons-material/SaveAlt';
import Upload from '@mui/icons-material/Upload';
import Refresh from '@mui/icons-material/Refresh';
import SwapHoriz from '@mui/icons-material/SwapHoriz';
import type {
  PositionCard,
  PositionKind,
  PolymarketCardData,
  OptionsCardData,
  FuturesCardData,
  PolymarketPosition,
  BybitPosition,
  CryptoOption,
  OptionType,
  BybitSide,
  Side,
  BybitOptionChain as BybitChainType,
  BuilderTransferPayload,
} from '../../types';
import { AddPositionDialog } from './AddPositionDialog';
import { PolymarketCard } from './PolymarketCard';
import { OptionsCard } from './OptionsCard';
import { FuturesCard } from './FuturesCard';
import { ProjectionChart } from '../shared/ProjectionChart';
import { usePortfolioCurves, type FuturesPositionForCurve } from '../../hooks/usePortfolioCurves';
import { solveImpliedVol, autoH, polyFeePerShare, bybitTradingFee, type SmilePoint } from '../../pricing/engine';
import { fetchCurrentPrice } from '../../api/binance';

interface PositionBuilderTabProps {
  transferPayload: BuilderTransferPayload | null;
  onTransferConsumed: () => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function detectCryptoFromSymbol(symbol: string): CryptoOption | null {
  const upper = symbol.toUpperCase();
  for (const c of ['BTC', 'ETH', 'SOL', 'XRP'] as CryptoOption[]) {
    if (upper.startsWith(c)) return c;
  }
  return null;
}

function roundToNice(value: number, direction: 'down' | 'up'): number {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
  return direction === 'down'
    ? Math.floor(value / magnitude) * magnitude
    : Math.ceil(value / magnitude) * magnitude;
}

/** Format a crypto price with precision appropriate to its magnitude. */
function formatPrice(price: number): string {
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100)  return price.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 10)   return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1)    return price.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function getEarliestMarketExpiry(data: PolymarketCardData): number {
  let earliest = Infinity;
  for (const market of data.markets) {
    if (market.endDate > 0 && market.endDate < earliest) {
      earliest = market.endDate;
    }
  }
  if (earliest === Infinity && data.event?.endDate && data.event.endDate > 0) {
    return data.event.endDate;
  }
  return earliest === Infinity ? 0 : earliest;
}

function getOptionsCardExpiry(data: OptionsCardData): number {
  let earliest = Infinity;
  for (const opt of data.selectedOptions) {
    if (opt.expiryTimestamp && opt.expiryTimestamp > 0) {
      const tsSec = Math.floor(opt.expiryTimestamp / 1000);
      if (tsSec > 0 && tsSec < earliest) {
        earliest = tsSec;
      }
    }
  }
  if (earliest === Infinity && data.chain?.expiryTimestamp) {
    const tsSec = Math.floor(data.chain.expiryTimestamp / 1000);
    return tsSec > 0 ? tsSec : 0;
  }
  return earliest === Infinity ? 0 : earliest;
}

function getCardExpiryTs(card: PositionCard): number {
  if (card.kind === 'polymarket') {
    return getEarliestMarketExpiry(card.data as PolymarketCardData);
  }
  if (card.kind === 'options') {
    return getOptionsCardExpiry(card.data as OptionsCardData);
  }
  return 0;
}

export function PositionBuilderTab({ transferPayload, onTransferConsumed }: PositionBuilderTabProps) {
  const [cards, setCards] = useState<PositionCard[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [spotPrice, setSpotPrice] = useState(0);
  const [primaryCrypto, setPrimaryCrypto] = useState<CryptoOption | null>(null);
  const [primaryOptionType, setPrimaryOptionType] = useState<OptionType>('above');
  const [bybitChain, setBybitChain] = useState<BybitChainType | null>(null);
  const [priceRange, setPriceRange] = useState<[number, number]>([60000, 120000]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nowSec = Math.floor(Date.now() / 1000);
  const primaryPolyCardData = useMemo<PolymarketCardData | null>(() => {
    let best: PolymarketCardData | null = null;
    let earliest = Infinity;
    for (const card of cards) {
      if (card.kind !== 'polymarket') continue;
      const data = card.data as PolymarketCardData;
      const expiry = getEarliestMarketExpiry(data);
      if (expiry > 0 && expiry < earliest) {
        earliest = expiry;
        best = data;
      }
    }
    return best;
  }, [cards]);
  const derivedCryptoFromCards = useMemo<CryptoOption | null>(() => {
    for (const card of cards) {
      if (card.kind !== 'polymarket') continue;
      const data = card.data as PolymarketCardData;
      if (data.crypto) return data.crypto;
    }
    return null;
  }, [cards]);
  useEffect(() => {
    if (derivedCryptoFromCards && derivedCryptoFromCards !== primaryCrypto) {
      setPrimaryCrypto(derivedCryptoFromCards);
    }
  }, [derivedCryptoFromCards, primaryCrypto]);
  useEffect(() => {
    if (primaryPolyCardData && primaryOptionType !== primaryPolyCardData.optionType) {
      setPrimaryOptionType(primaryPolyCardData.optionType);
    }
  }, [primaryPolyCardData, primaryOptionType]);
  const groupExpiryTs = useMemo(() => {
    let earliest = Infinity;
    for (const card of cards) {
      const expiry = getCardExpiryTs(card);
      if (expiry > 0 && expiry < earliest) earliest = expiry;
    }
    return earliest === Infinity ? 0 : earliest;
  }, [cards]);
  const groupExpiryLabel = groupExpiryTs > 0
    ? new Date(groupExpiryTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Load spot price when crypto is detected
  useEffect(() => {
    if (!primaryCrypto) return;
    fetchCurrentPrice(primaryCrypto)
      .then(price => {
        if (price > 0) {
          setSpotPrice(price);
          if (priceRange[0] === 60000 && priceRange[1] === 120000) {
            setPriceRange([roundToNice(price * 0.6, 'down'), roundToNice(price * 1.4, 'up')]);
          }
        }
      })
      .catch(() => {});
  }, [primaryCrypto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle transfer payload from Position Finder
  useEffect(() => {
    if (!transferPayload) return;
    const newCards: PositionCard[] = [];

    if (transferPayload.polyEvent) {
      const polyCard: PositionCard = {
        id: generateId(),
        kind: 'polymarket',
        data: {
          event: transferPayload.polyEvent,
          optionType: transferPayload.optionType,
          crypto: transferPayload.crypto,
          markets: transferPayload.polyMarkets,
          selections: transferPayload.polySelections,
          minimized: false,
        } as PolymarketCardData,
      };
      newCards.push(polyCard);
    }

    if (transferPayload.bybitChainData && transferPayload.bybitSelections.length > 0) {
      const { bybitChainData, bybitSelections } = transferPayload;
      const tickersMap = new Map(
        bybitChainData.tickers.map(t => [t.symbol, t])
      );
      const chain: BybitChainType = {
        expiryLabel: bybitChainData.expiryLabel,
        expiryTimestamp: bybitChainData.expiryTimestamp,
        instruments: bybitChainData.instruments,
        tickers: tickersMap,
      };
      const optCard: PositionCard = {
        id: generateId(),
        kind: 'options',
        data: {
          chain,
          selectedOptions: bybitSelections,
          minimized: false,
        } as OptionsCardData,
      };
      newCards.push(optCard);
      setBybitChain(chain);
    }

    if (newCards.length > 0) {
      setCards(prev => [...prev, ...newCards]);
      if (transferPayload.spotPrice > 0) setSpotPrice(transferPayload.spotPrice);
    }
    onTransferConsumed();
  }, [transferPayload]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddCard = useCallback((kind: PositionKind) => {
    const defaultFuturesSymbol = 'BTCUSDT';
    const baseData = kind === 'polymarket'
      ? { event: null, optionType: primaryOptionType, crypto: primaryCrypto, markets: [], selections: [], minimized: false }
      : kind === 'options'
      ? { chain: null, selectedOptions: [], minimized: false }
      : { symbol: defaultFuturesSymbol, entryPrice: spotPrice || 0, size: 0.001, leverage: 5, minimized: false };

    setCards(prev => [...prev, { id: generateId(), kind, data: baseData as PolymarketCardData | OptionsCardData | FuturesCardData }]);

    // Auto-detect crypto from futures symbol to trigger spot price fetch
    if (kind === 'futures' && !primaryCrypto) {
      const crypto = detectCryptoFromSymbol(defaultFuturesSymbol);
      if (crypto) setPrimaryCrypto(crypto);
    }
  }, [primaryOptionType, primaryCrypto, spotPrice]);

  const handleUpdateCard = useCallback(<T extends PolymarketCardData | OptionsCardData | FuturesCardData>(id: string, newData: T) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, data: newData } : c));

    // Update primary state when first polymarket card loads an event
    // Detect crypto from futures symbol updates to trigger spot price fetch
    if (!primaryCrypto && 'symbol' in newData && typeof (newData as { symbol?: unknown }).symbol === 'string') {
      const crypto = detectCryptoFromSymbol((newData as FuturesCardData).symbol);
      if (crypto) setPrimaryCrypto(crypto);
    }
  }, [primaryCrypto]);

  const handleRemoveCard = useCallback((id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleInverse = useCallback(() => {
    setCards(prev => prev.map(card => {
      if (card.kind === 'polymarket') {
        const data = card.data as PolymarketCardData;
        return {
          ...card,
          data: {
            ...data,
            selections: data.selections.map(s => ({
              ...s,
              side: (s.side === 'YES' ? 'NO' : 'YES') as Side,
              entryPrice: Math.max(0, Math.min(1, 1 - s.entryPrice)),
            })),
          },
        };
      }
      if (card.kind === 'options') {
        const data = card.data as OptionsCardData;
        return {
          ...card,
          data: {
            ...data,
            selectedOptions: data.selectedOptions.map(o => ({
              ...o,
              side: (o.side === 'buy' ? 'sell' : 'buy') as BybitSide,
            })),
          },
        };
      }
      if (card.kind === 'futures') {
        const data = card.data as FuturesCardData;
        return { ...card, data: { ...data, size: -data.size } };
      }
      return card;
    }));
  }, []);

  const handleMinimizeCard = useCallback((id: string) => {
    setCards(prev => prev.map(c =>
      c.id === id ? { ...c, data: { ...c.data, minimized: !c.data.minimized } } : c
    ));
  }, []);

  const handleChainLoaded = useCallback((chain: BybitChainType) => {
    setBybitChain(chain);
    // Auto-detect crypto from chain instrument symbol to trigger spot price fetch
    if (!primaryCrypto && chain.instruments[0]) {
      const crypto = detectCryptoFromSymbol(chain.instruments[0].symbol);
      if (crypto) setPrimaryCrypto(crypto);
    }
  }, [primaryCrypto]);

  // Called when "Add to Builder" is pressed in HedgeItPanel — create/update an OptionsCard
  const handleAddHedgeLegs = useCallback((
    longOpt: OptionsCardData['selectedOptions'][0],
    shortOpt: OptionsCardData['selectedOptions'][0],
  ) => {
    setCards(prev => {
      // Find an existing OptionsCard with matching chain, or create a new one
      const existingIdx = prev.findIndex(c => c.kind === 'options' && bybitChain &&
        (c.data as OptionsCardData).chain?.expiryTimestamp === bybitChain.expiryTimestamp);
      if (existingIdx >= 0) {
        return prev.map((c, i) => {
          if (i !== existingIdx) return c;
          const d = c.data as OptionsCardData;
          // Merge legs (replace if same symbol+side, else append)
          const filtered = d.selectedOptions.filter(
            o => !(o.symbol === longOpt.symbol && o.side === longOpt.side) &&
                 !(o.symbol === shortOpt.symbol && o.side === shortOpt.side)
          );
          return { ...c, data: { ...d, selectedOptions: [...filtered, longOpt, shortOpt] } };
        });
      }
      // Create new OptionsCard with the chain pre-loaded
      const newCard: PositionCard = {
        id: generateId(),
        kind: 'options',
        data: {
          chain: bybitChain,
          selectedOptions: [longOpt, shortOpt],
          minimized: false,
        } as OptionsCardData,
      };
      return [...prev, newCard];
    });
  }, [bybitChain]);

  const [reloadKey, setReloadKey] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const handleSaveSnapshot = useCallback(async () => {
    // Save full card state (options chain omitted — too large; selectedOptions preserved for chart)
    const dateStr = new Date().toISOString().slice(0, 10);
    const serialized = cards.map(card => {
      if (card.kind === 'options') {
        const d = card.data as OptionsCardData;
        return { id: card.id, kind: card.kind, data: { chain: null, selectedOptions: d.selectedOptions, minimized: d.minimized } };
      }
      return { id: card.id, kind: card.kind, data: card.data };
    });
    const blob = new Blob([JSON.stringify({ kind: 'builder_full_save', cards: serialized, spotPrice, priceRange }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `builder_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (chartRef.current) {
      const imgBlob = await elementToBlob(chartRef.current, { pixelRatio: 2 });
      if (imgBlob) {
        const imgUrl = URL.createObjectURL(imgBlob);
        const imgA = document.createElement('a');
        imgA.href = imgUrl;
        imgA.download = `builder_chart_${dateStr}.png`;
        imgA.click();
        URL.revokeObjectURL(imgUrl);
      }
    }
  }, [cards, spotPrice, priceRange]);

  const handleLoadSnapshot = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed?.kind === 'builder_full_save' && Array.isArray(parsed.cards)) {
          const loaded = parsed.cards as PositionCard[];

          // Validate options cards for expiry and required fields
          const nowMs = Date.now();
          for (const card of loaded) {
            if (card.kind !== 'options') continue;
            const d = card.data as OptionsCardData;
            for (const opt of d.selectedOptions ?? []) {
              // Guard against missing required fields that would crash the render
              if (opt.entryPrice == null) (opt as Record<string, unknown>).entryPrice = 0;
              if (opt.quantity == null) (opt as Record<string, unknown>).quantity = 0.01;
              if (opt.markIv == null) (opt as Record<string, unknown>).markIv = 0;
              // Warn if option has expired
              if (opt.expiryTimestamp && opt.expiryTimestamp < nowMs) {
                const expStr = new Date(opt.expiryTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                setLoadError(
                  `This file contains expired options (expired ${expStr}). ` +
                  `The P&L chart will show at-expiry payoff only. ` +
                  `To view historical performance, use the Backtester tab.`
                );
              }
            }
          }

          setCards(loaded);
          // Restore primary state from first poly card, or detect crypto from options/futures if no poly card
          const firstPoly = loaded.find(c => c.kind === 'polymarket');
          if (firstPoly) {
            const d = firstPoly.data as PolymarketCardData;
            if (d.crypto) setPrimaryCrypto(d.crypto);
            setPrimaryOptionType(d.optionType);
          } else {
            const firstOptions = loaded.find(c => c.kind === 'options');
            const firstFutures = loaded.find(c => c.kind === 'futures');
            const detectionSymbol =
              (firstOptions && ((firstOptions.data as OptionsCardData).selectedOptions[0]?.symbol)) ||
              (firstFutures && (firstFutures.data as FuturesCardData).symbol);
            if (detectionSymbol) {
              const crypto = detectCryptoFromSymbol(detectionSymbol);
              if (crypto) setPrimaryCrypto(crypto);
            }
          }

          // Restore spotPrice and priceRange if saved
          if (parsed.spotPrice > 0) setSpotPrice(parsed.spotPrice);
          if (Array.isArray(parsed.priceRange) && parsed.priceRange.length === 2) {
            setPriceRange(parsed.priceRange as [number, number]);
          }
        } else if (parsed?.version === 'position_hedger_snapshot_v1') {
          const v1 = parsed;
          const newCards: PositionCard[] = [];

          // Rebuild Polymarket card
          if (Array.isArray(v1.polyMarkets) && Array.isArray(v1.polySelections)) {
            const selections = v1.polySelections.map((sel: { marketId: string; side: string; quantity: number }) => {
              const market = v1.polyMarkets.find((m: { id: string }) => m.id === sel.marketId);
              let entryPrice = 0;
              if (market) {
                if (sel.side === 'YES') entryPrice = market.bestAsk ?? market.currentPrice;
                else entryPrice = 1 - (market.bestBid ?? market.currentPrice);
              }
              return { marketId: sel.marketId, side: sel.side, quantity: sel.quantity, entryPrice };
            });
            const loadedEvent = v1.polyEvent
              ? { ...v1.polyEvent, markets: v1.polyEvent.markets ?? [] }
              : null;
            newCards.push({
              id: generateId(),
              kind: 'polymarket',
              data: {
                event: loadedEvent,
                optionType: v1.optionType ?? 'above',
                crypto: v1.crypto ?? null,
                markets: v1.polyMarkets,
                selections,
                minimized: false,
              } as PolymarketCardData,
            });
            if (v1.crypto) setPrimaryCrypto(v1.crypto);
            if (v1.optionType) setPrimaryOptionType(v1.optionType);
          }

          // Rebuild Options card from bybitChain + bybitSelections
          if (v1.bybitChain && Array.isArray(v1.bybitSelections) && v1.bybitSelections.length > 0) {
            const tickersArr: Array<{ symbol: string; bid1Price?: string | number; ask1Price?: string | number; markPrice?: string | number; markIv?: number; delta?: number; gamma?: number; vega?: number; theta?: number }> =
              v1.bybitChain.tickers ?? [];
            const tickersMap = new Map(tickersArr.map(t => [t.symbol, {
              symbol: t.symbol,
              bid1Price: parseFloat(String(t.bid1Price ?? 0)),
              ask1Price: parseFloat(String(t.ask1Price ?? 0)),
              markPrice: parseFloat(String(t.markPrice ?? 0)),
              markIv: t.markIv ?? 0,
              delta: t.delta ?? 0,
              gamma: t.gamma ?? 0,
              vega: t.vega ?? 0,
              theta: t.theta ?? 0,
            }]));
            const chain: BybitChainType = {
              expiryLabel: v1.bybitChain.expiryLabel,
              expiryTimestamp: v1.bybitChain.expiryTimestamp,
              instruments: v1.bybitChain.instruments,
              tickers: tickersMap,
            };
            const selectedOptions = v1.bybitSelections.map((sel: { symbol: string; side: string; quantity: number }) => {
              const inst = (v1.bybitChain.instruments as Array<{ symbol: string; optionsType: string; strike: number; expiryTimestamp: number }>)
                .find(i => i.symbol === sel.symbol);
              const ticker = tickersMap.get(sel.symbol);
              const entryPrice = sel.side === 'buy'
                ? (ticker?.ask1Price ?? 0)
                : (ticker?.bid1Price ?? 0);
              return {
                symbol: sel.symbol,
                optionsType: (inst?.optionsType ?? 'Call') as 'Call' | 'Put',
                strike: inst?.strike ?? 0,
                expiryTimestamp: inst?.expiryTimestamp ?? v1.bybitChain.expiryTimestamp,
                side: sel.side as 'buy' | 'sell',
                quantity: sel.quantity,
                entryPrice,
                markIv: ticker?.markIv ?? 0,
              };
            });

            // Warn if options have expired
            const nowMs = Date.now();
            const expiredOpt = selectedOptions.find((opt: { expiryTimestamp: number }) => opt.expiryTimestamp && opt.expiryTimestamp < nowMs);
            if (expiredOpt) {
              const expStr = new Date(expiredOpt.expiryTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              setLoadError(
                `This file contains expired options (expired ${expStr}). ` +
                `The P&L chart will show at-expiry payoff only. ` +
                `To view historical performance, use the Backtester tab.`
              );
            }

            newCards.push({
              id: generateId(),
              kind: 'options',
              data: { chain, selectedOptions, minimized: false } as OptionsCardData,
            });
            setBybitChain(chain);
          }

          if (newCards.length > 0) {
            setCards(newCards);
            if (v1.spotPrice > 0) setSpotPrice(v1.spotPrice);
            // Only restore saved price range if options haven't expired — expired files
            // have stale ranges that no longer match the live spot price.
            const optionsExpired = v1.bybitChain?.expiryTimestamp && v1.bybitChain.expiryTimestamp < Date.now();
            if (!optionsExpired && Array.isArray(v1.priceRange) && v1.priceRange.length === 2) {
              setPriceRange(v1.priceRange as [number, number]);
            }
          } else {
            setLoadError('This file has no positions to load.');
          }
        } else {
          setLoadError('Unrecognized file format. Please upload a valid position builder snapshot (.json).');
        }
      } catch (err) {
        console.error('[Builder] file load failed:', err);
        setLoadError(`Failed to load file: ${err instanceof Error ? err.message : 'invalid format'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // Compute smile from polymarket positions
  const smile = useMemo((): SmilePoint[] | undefined => {
    const polyCards = cards.filter(c => c.kind === 'polymarket');
    if (polyCards.length === 0 || spotPrice <= 0) return undefined;

    const points: SmilePoint[] = [];
    for (const card of polyCards) {
      const d = card.data as PolymarketCardData;
      for (const market of d.markets) {
        if (market.strikePrice <= 0 || market.currentPrice <= 0 || market.currentPrice >= 1) continue;
        const tauPoly = Math.max((market.endDate - nowSec) / (365.25 * 24 * 3600), 0);
        if (tauPoly <= 0) continue;
        const isUpBarrier = market.strikePrice > spotPrice;
        const H = autoH(tauPoly);
        const iv = solveImpliedVol(spotPrice, market.strikePrice, tauPoly, market.currentPrice, d.optionType, isUpBarrier, H);
        if (iv !== null && iv > 0) {
          points.push({ moneyness: Math.log(spotPrice / market.strikePrice), iv });
        }
      }
    }
    if (points.length < 2) return undefined;
    return points.sort((a, b) => a.moneyness - b.moneyness);
  }, [cards, spotPrice, nowSec]);

  // Build bybitSmile from the loaded chain
  const bybitSmile = useMemo((): SmilePoint[] | undefined => {
    if (!bybitChain || spotPrice <= 0) return undefined;
    const points: SmilePoint[] = [];
    for (const inst of bybitChain.instruments) {
      const ticker = bybitChain.tickers.get(inst.symbol);
      if (!ticker || ticker.markIv <= 0) continue;
      points.push({ moneyness: Math.log(spotPrice / inst.strike), iv: ticker.markIv });
    }
    if (points.length < 2) return undefined;
    return points.sort((a, b) => a.moneyness - b.moneyness);
  }, [bybitChain, spotPrice]);

  // Derive PolymarketPosition[] from cards
  const polyPositions = useMemo((): PolymarketPosition[] => {
    if (spotPrice <= 0) return [];
    const positions: PolymarketPosition[] = [];
    for (const card of cards) {
      if (card.kind !== 'polymarket') continue;
      const d = card.data as PolymarketCardData;
      for (const sel of d.selections) {
        const market = d.markets.find(m => m.id === sel.marketId);
        if (!market) continue;
        const tauPoly = Math.max((market.endDate - nowSec) / (365.25 * 24 * 3600), 0);
        const isUpBarrier = market.strikePrice > spotPrice;
        const H = autoH(tauPoly);
        const iv = solveImpliedVol(spotPrice, market.strikePrice, tauPoly, market.currentPrice, d.optionType, isUpBarrier, H) ?? 0.5;
        positions.push({
          marketId: market.id,
          question: market.question,
          groupItemTitle: market.groupItemTitle,
          strikePrice: market.strikePrice,
          side: sel.side,
          entryPrice: sel.entryPrice,
          impliedVol: iv,
          isUpBarrier,
          quantity: sel.quantity,
          entryFee: (d.priceMode ?? 'ask') !== 'bid' ? polyFeePerShare(sel.entryPrice) * sel.quantity : 0,
          optionType: d.optionType,
          endDate: market.endDate,
        });
      }
    }
    return positions;
  }, [cards, spotPrice, nowSec]);

  // Derive BybitPosition[] from cards
  const bybitPositions = useMemo((): BybitPosition[] => {
    const positions: BybitPosition[] = [];
    for (const card of cards) {
      if (card.kind !== 'options') continue;
      const d = card.data as OptionsCardData;
      for (const opt of d.selectedOptions) {
        positions.push({
          symbol: opt.symbol,
          optionsType: opt.optionsType,
          strike: opt.strike,
          expiryTimestamp: opt.expiryTimestamp,
          side: opt.side,
          entryPrice: opt.entryPrice,
          markIv: opt.markIv,
          quantity: opt.quantity,
          entryFee: spotPrice > 0 ? bybitTradingFee(spotPrice, opt.entryPrice, opt.quantity) : 0,
        });
      }
    }
    return positions;
  }, [cards, spotPrice]);

  // Derive futures positions
  const futuresPositions = useMemo((): FuturesPositionForCurve[] => {
    return cards
      .filter(c => c.kind === 'futures')
      .map(c => {
        const d = c.data as FuturesCardData;
        return { entryPrice: d.entryPrice, size: d.size };
      })
      .filter(fp => fp.entryPrice > 0 && fp.size !== 0);
  }, [cards]);

  // Get primary poly expiry
  const polyExpiryTs = useMemo(() => {
    let earliest = Infinity;
    for (const card of cards) {
      if (card.kind !== 'polymarket') continue;
      const data = card.data as PolymarketCardData;
      const expiry = getEarliestMarketExpiry(data);
      if (expiry > 0 && expiry < earliest) {
        earliest = expiry;
      }
    }
    return earliest === Infinity ? 0 : earliest;
  }, [cards]);

  const polyTauNow = Math.max((polyExpiryTs - nowSec) / (365.25 * 24 * 3600), 0);

  const curves = usePortfolioCurves({
    polyPositions,
    bybitPositions,
    futuresPositions,
    lowerPrice: priceRange[0],
    upperPrice: priceRange[1],
    polyTauNow,
    polyExpiryTs,
    optionType: primaryOptionType,
    smile,
    bybitSmile,
    numPoints: 800,
    spotPrice: spotPrice > 0 ? spotPrice : undefined,
  });

  const cryptoSymbol = primaryCrypto ?? 'BTC';

  const sliderBounds: [number, number] = useMemo(() => {
    if (spotPrice <= 0) return [30000, 200000];
    return [roundToNice(spotPrice * 0.2, 'down'), roundToNice(spotPrice * 2.0, 'up')];
  }, [spotPrice]);

  const sliderStep = useMemo(() => {
    const range = sliderBounds[1] - sliderBounds[0];
    if (range <= 0) return 1;
    return Math.pow(10, Math.floor(Math.log10(range)) - 1);
  }, [sliderBounds]);

  const hasPositions = polyPositions.length > 0 || bybitPositions.length > 0 || futuresPositions.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top toolbar: Refresh / Load / Save */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <input ref={uploadRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoadSnapshot} />
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => setReloadKey(k => k + 1)} disabled={cards.length === 0}>
          Refresh
        </Button>
        <Button size="small" variant="outlined" startIcon={<Upload />} onClick={() => uploadRef.current?.click()}>
          Load
        </Button>
        <Button size="small" variant="outlined" startIcon={<SaveAlt />} onClick={handleSaveSnapshot} disabled={cards.length === 0}>
          Save
        </Button>
      </Box>

      {loadError && (
        <Alert severity="warning" onClose={() => setLoadError(null)} sx={{ mb: 0 }}>
          {loadError}
        </Alert>
      )}

      {/* Chart */}
      <Paper sx={{ p: 2 }}>
        <div ref={chartRef}>
        {hasPositions ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Typography variant="h6" fontWeight={600}>Portfolio P&L</Typography>
              {spotPrice > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Spot: ${formatPrice(spotPrice)}
                </Typography>
              )}
              {groupExpiryLabel && (
                <Typography variant="body2" color="text.secondary">
                  Earliest expiry: {groupExpiryLabel}
                </Typography>
              )}
            </Box>

            {/* Selected position chips — similar to position finder */}
            {(polyPositions.length > 0 || bybitPositions.length > 0 || cards.some(c => c.kind === 'futures')) && (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                {polyPositions.map((pos, i) => (
                  <Chip
                    key={i}
                    label={`● ${pos.side} ${pos.groupItemTitle} ×${pos.quantity} @ ${(pos.entryPrice * 100).toFixed(1)}¢`}
                    size="small"
                    sx={{ bgcolor: '#4A90D9', color: '#fff', fontFamily: 'monospace', fontSize: '0.72rem' }}
                  />
                ))}
                {bybitPositions.map((pos, i) => (
                  <Chip
                    key={i}
                    label={`${pos.side === 'buy' ? '●' : '✕'} ${pos.side === 'buy' ? 'Long' : 'Short'} ${pos.symbol} ×${pos.quantity} @ $${formatPrice(pos.entryPrice)}`}
                    size="small"
                    sx={{ bgcolor: '#FF8C00', color: '#fff', fontFamily: 'monospace', fontSize: '0.72rem' }}
                  />
                ))}
                {cards.filter(c => c.kind === 'futures').map((c, i) => {
                  const d = c.data as FuturesCardData;
                  if (!d.entryPrice || !d.size) return null;
                  const asset = ['ETH','SOL','XRP'].find(a => d.symbol.startsWith(a)) ?? 'BTC';
                  const lev = d.leverage ?? 5;
                  return (
                    <Chip
                      key={i}
                      label={`● ${d.size >= 0 ? 'Long' : 'Short'} ${asset} ×${Math.abs(d.size)} @ $${d.entryPrice.toLocaleString()} ×${lev}`}
                      size="small"
                      sx={{ bgcolor: 'text.secondary', color: '#fff', fontFamily: 'monospace', fontSize: '0.72rem' }}
                    />
                  );
                })}
              </Box>
            )}

            <ProjectionChart
              combinedCurves={curves.combinedCurves}
              combinedLabels={curves.combinedLabels}
              polyNowCurve={curves.polyNowCurve}
              polyExpiryCurve={curves.polyExpiryCurve}
              bybitNowCurve={curves.bybitNowCurve}
              bybitExpiryCurve={curves.bybitExpiryCurve}
              polyAtBybitExpiryCurve={curves.polyAtBybitExpiryCurve}
              futuresNowCurve={curves.futuresNowCurve}
              currentCryptoPrice={spotPrice}
              cryptoSymbol={cryptoSymbol}
              totalEntryCost={curves.totalEntryCost}
              polyEntryCost={curves.polyEntryCost}
              bybitEntryCost={curves.bybitEntryCost}
            />

            {/* Price range slider — moved below chart */}
            {spotPrice > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'flex-end', mb: 0.5 }}>
                  <TextField
                    label="Min Price"
                    size="small"
                    type="number"
                    value={priceRange[0]}
                    onChange={e => setPriceRange([parseInt(e.target.value) || priceRange[0], priceRange[1]])}
                    sx={{ width: 120 }}
                    inputProps={{ step: 1000 }}
                  />
                  <TextField
                    label="Max Price"
                    size="small"
                    type="number"
                    value={priceRange[1]}
                    onChange={e => setPriceRange([priceRange[0], parseInt(e.target.value) || priceRange[1]])}
                    sx={{ width: 120 }}
                    inputProps={{ step: 1000 }}
                  />
                </Box>
                <Box sx={{ px: 2 }}>
                  <Slider
                    value={priceRange}
                    onChange={(_, v) => setPriceRange(v as [number, number])}
                    min={sliderBounds[0]}
                    max={sliderBounds[1]}
                    step={sliderStep}
                    valueLabelDisplay="auto"
                    valueLabelFormat={v => `$${formatPrice(v as number)}`}
                  />
                </Box>
              </Box>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            Add positions below to see the P&L projection
          </Typography>
        )}
        </div>
      </Paper>

      {/* Position summary */}
      {hasPositions && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Position Summary</Typography>

          {polyPositions.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4A90D9' }}>
                Polymarket
              </Typography>
              {polyPositions.map((pos, i) => {
                const total = pos.entryPrice * pos.quantity;
                return (
                  <Box key={i} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.5, py: 0.3, pl: 1 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {pos.groupItemTitle} — {pos.side} ×{pos.quantity}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      @ {pos.entryPrice.toFixed(4)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      (total: ${total.toFixed(2)}, fee: ${pos.entryFee.toFixed(3)})
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {bybitPositions.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF8C00' }}>
                Bybit
              </Typography>
              {bybitPositions.map((pos, i) => {
                const total = pos.entryPrice * pos.quantity + pos.entryFee;
                return (
                  <Box key={i} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.5, py: 0.3, pl: 1 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {pos.symbol} — {pos.side} ×{pos.quantity}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      @ ${formatPrice(pos.entryPrice)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      (total: ${total.toFixed(2)}, fee: ${pos.entryFee.toFixed(2)})
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {futuresPositions.length > 0 && (() => {
            const futuresCards = cards
              .filter(c => c.kind === 'futures')
              .map(c => c.data as FuturesCardData)
              .filter(d => d.entryPrice > 0 && d.size !== 0);
            return (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary' }}>
                  Futures
                </Typography>
                {futuresCards.map((d, i) => {
                  const lev = d.leverage ?? 5;
                  const notional = Math.abs(d.size) * d.entryPrice;
                  const margin = lev > 0 ? notional / lev : 0;
                  const asset = ['ETH','SOL','XRP'].find(a => d.symbol.startsWith(a)) ?? 'BTC';
                  return (
                    <Box key={i} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.5, py: 0.3, pl: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {d.size >= 0 ? 'Long' : 'Short'} {asset} ×{Math.abs(d.size)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        @ ${d.entryPrice.toLocaleString()} · ×{lev} lev
                      </Typography>
                      {margin > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          · margin <strong>${margin.toFixed(2)}</strong>
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })()}

          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Total positions: <strong>{polyPositions.length + bybitPositions.length + futuresPositions.length}</strong>
            </Typography>
            {curves.totalEntryCost > 0 && (
              <Typography variant="body2" color="text.secondary">
                Net entry cost: <strong>${curves.totalEntryCost.toFixed(2)}</strong>
              </Typography>
            )}
            {curves.totalFees > 0 && (
              <Typography variant="body2" color="text.secondary">
                Fees: <strong>${curves.totalFees.toFixed(2)}</strong>
              </Typography>
            )}
            {spotPrice > 0 && (
              <Typography variant="body2" color="text.secondary">
                {cryptoSymbol}: <strong>${formatPrice(spotPrice)}</strong>
              </Typography>
            )}
            <Box sx={{ ml: 'auto' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SwapHoriz />}
                onClick={handleInverse}
                color="secondary"
                title="Flip all positions: YES↔NO for Polymarket, buy↔sell for options, long↔short for futures"
              >
                Inverse
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Cards */}
      <Box>
        {cards.map(card => {
          if (card.kind === 'polymarket') {
            return (
              <PolymarketCard
                key={card.id}
                id={card.id}
                data={card.data as PolymarketCardData}
                spotPrice={spotPrice}
                bybitChain={bybitChain}
                nowSec={nowSec}
                onUpdate={handleUpdateCard}
                onRemove={handleRemoveCard}
                onMinimize={handleMinimizeCard}
                onAddHedgeLegs={handleAddHedgeLegs}
                refreshToken={reloadKey}
              />
            );
          }
          if (card.kind === 'options') {
            return (
              <OptionsCard
                key={card.id}
                id={card.id}
                data={card.data as OptionsCardData}
                spotPrice={spotPrice}
                onUpdate={handleUpdateCard}
                onRemove={handleRemoveCard}
                onMinimize={handleMinimizeCard}
                onChainLoaded={handleChainLoaded}
                refreshToken={reloadKey}
              />
            );
          }
          if (card.kind === 'futures') {
            return (
              <FuturesCard
                key={card.id}
                id={card.id}
                data={card.data as FuturesCardData}
                spotPrice={spotPrice}
                onUpdate={handleUpdateCard}
                onRemove={handleRemoveCard}
                onMinimize={handleMinimizeCard}
              />
            );
          }
          return null;
        })}

        {cards.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <Typography variant="h6">No positions yet</Typography>
            <Typography variant="body2">Click the + button to add a position</Typography>
          </Box>
        )}
      </Box>

      {/* Floating add button */}
      <Fab
        color="primary"
        onClick={() => setAddDialogOpen(true)}
        sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100 }}
      >
        <Add />
      </Fab>

      <AddPositionDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={handleAddCard}
      />
    </Box>
  );
}
