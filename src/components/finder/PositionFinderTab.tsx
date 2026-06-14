import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  buildSnapshot,
  parseSnapshot,
  downloadJson,
  downloadElementPng,
  readJsonFile,
} from '../../io/snapshot';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  CircularProgress,
  Alert,
  Chip,
  Tooltip,
} from '@mui/material';
import Send from '@mui/icons-material/Send';
import SaveAlt from '@mui/icons-material/SaveAlt';
import Refresh from '@mui/icons-material/Refresh';
import Upload from '@mui/icons-material/Upload';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import type {
  PolymarketEvent,
  ParsedMarket,
  CryptoOption,
  BybitBaseCoin,
  OptionType,
  BybitOptionChain as BybitChainType,
  StrikeOptResult,
  OptMatchResult,
  BuilderTransferPayload,
  BybitInstrument,
  BybitTicker,
  Side,
  PositionCard,
  PolymarketCardData,
  OptionsCardData,
} from '../../types';
import { PolymarketSearch } from '../shared/PolymarketSearch';
import { BybitOptionChain } from '../shared/BybitOptionChain';
import { FinderTable, VizCard } from './FinderResults';
import { runOptimization } from '../../optimization/optimizer';
import { fetchCurrentPrice } from '../../api/binance';
import { fetchEventBySlug, parseMarkets } from '../../api/polymarket';
import { type SmilePoint } from '../../pricing/engine';

interface PositionFinderTabProps {
  onSendToBuilder: (payload: BuilderTransferPayload) => void;
}

function preferredBybitBase(asset: CryptoOption | null): BybitBaseCoin {
  return asset === 'XAUT' ? 'XAUT' : 'BTC';
}

export function PositionFinderTab({ onSendToBuilder }: PositionFinderTabProps) {
  const [polyEvent, setPolyEvent] = useState<PolymarketEvent | null>(null);
  const [polyMarkets, setPolyMarkets] = useState<ParsedMarket[]>([]);
  const [crypto, setCrypto] = useState<CryptoOption | null>(null);
  const [optionType, setOptionType] = useState<OptionType>('above');
  const [bybitChain, setBybitChain] = useState<BybitChainType | null>(null);
  const [spotPrice, setSpotPrice] = useState(0);
  const [results, setResults] = useState<StrikeOptResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bybitQty, setBybitQty] = useState(0.01);
  const [bybitBase, setBybitBase] = useState<BybitBaseCoin>('BTC');
  const [selectedResult, setSelectedResult] = useState<StrikeOptResult | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<OptMatchResult | null>(null);
  const [loadedExpiry, setLoadedExpiry] = useState<number | undefined>(undefined);

  const [chainRefreshToken, setChainRefreshToken] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartSectionRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // Quantized to the minute so its value is stable across rapid re-renders
  // (keeps memo/callback deps from invalidating every render) while still
  // advancing over a long session. Minute granularity is negligible vs. tau.
  const nowSec = Math.floor(Date.now() / 60000) * 60;

  // Refs to hold latest values for use inside stable callbacks (avoids stale closures)
  const pendingAutoRunRef = useRef(false);
  const latestPolyMarketsRef = useRef<ParsedMarket[]>([]);
  const latestSpotRef = useRef(0);
  const latestOptionTypeRef = useRef<OptionType>('above');

  useEffect(() => { latestPolyMarketsRef.current = polyMarkets; }, [polyMarkets]);
  useEffect(() => { latestSpotRef.current = spotPrice; }, [spotPrice]);
  useEffect(() => { latestOptionTypeRef.current = optionType; }, [optionType]);

  const smile = useMemo((): SmilePoint[] => {
    if (spotPrice <= 0) return [];
    const points: SmilePoint[] = [];
    for (const r of results) {
      if (r.polyIv <= 0) continue;
      points.push({ moneyness: Math.log(spotPrice / r.market.strikePrice), iv: r.polyIv });
    }
    return points.sort((a, b) => a.moneyness - b.moneyness);
  }, [results, spotPrice]);

  const handleEventLoaded = useCallback(async (
    event: PolymarketEvent,
    markets: ParsedMarket[],
    detectedCrypto: CryptoOption | null,
    detectedOptionType: OptionType,
  ) => {
    setPolyEvent(event);
    setPolyMarkets(markets);
    latestPolyMarketsRef.current = markets;
    setCrypto(detectedCrypto);
    setBybitBase(preferredBybitBase(detectedCrypto));
    setOptionType(detectedOptionType);
    latestOptionTypeRef.current = detectedOptionType;
    setResults([]);
    setSelectedResult(null);
    setSelectedMatch(null);

    if (detectedCrypto) {
      try {
        const price = await fetchCurrentPrice(detectedCrypto);
        if (price > 0) {
          setSpotPrice(price);
          latestSpotRef.current = price;
        }
      } catch { /* ignore */ }
    }
  }, []);

  const handleChainSelected = useCallback((chain: BybitChainType | null) => {
    setBybitChain(chain);
    setSelectedResult(null);
    setSelectedMatch(null);

    if (pendingAutoRunRef.current && chain && latestPolyMarketsRef.current.length > 0 && latestSpotRef.current > 0) {
      pendingAutoRunRef.current = false;
      const ts = Math.floor(Date.now() / 1000);
      try {
        const r = runOptimization(latestPolyMarketsRef.current, latestOptionTypeRef.current, latestSpotRef.current, ts, chain, 0.01);
        setResults(r);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Optimization failed');
        setResults([]);
        setLoading(false);
      }
    } else {
      setResults([]);
    }
  }, []);

  const handleSpotLoaded = useCallback((price: number) => {
    const bybitMatchesEvent =
      !crypto ||
      (bybitBase === 'BTC' && crypto === 'BTC') ||
      (bybitBase === 'XAUT' && crypto === 'XAUT');
    if (!bybitMatchesEvent) return;
    if (price > 0) {
      setSpotPrice(price);
      latestSpotRef.current = price;
    }
  }, [crypto, bybitBase]);

  const handleRun = useCallback(async () => {
    if (!bybitChain || polyMarkets.length === 0 || spotPrice <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = runOptimization(polyMarkets, optionType, spotPrice, nowSec, bybitChain, 0.01);
      setResults(r);
      setSelectedResult(null);
      setSelectedMatch(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setLoading(false);
    }
  }, [bybitChain, polyMarkets, optionType, spotPrice, nowSec]);

  // Refresh: re-fetch polymarket prices + bitcoin price, then re-fetch Bybit chain,
  // then auto-run optimization with all fresh data.
  const handleRefresh = useCallback(async () => {
    if (polyMarkets.length === 0) return;
    setLoading(true);
    setError(null);

    const fetches: Promise<void>[] = [];

    if (polyEvent?.slug) {
      fetches.push(
        fetchEventBySlug(polyEvent.slug)
          .then(freshEvent => {
            const freshMarkets = parseMarkets(freshEvent.markets);
            latestPolyMarketsRef.current = freshMarkets;
            setPolyMarkets(freshMarkets);
          })
          .catch(() => {})
      );
    }

    if (crypto) {
      fetches.push(
        fetchCurrentPrice(crypto)
          .then(price => {
            if (price > 0) {
              latestSpotRef.current = price;
              setSpotPrice(price);
            }
          })
          .catch(() => {})
      );
    }

    // Wait for polymarket + bitcoin before triggering chain refresh
    await Promise.all(fetches);
    pendingAutoRunRef.current = true;
    setChainRefreshToken(t => t + 1);
    // Loading is cleared inside handleChainSelected once optimization completes
  }, [polyMarkets.length, polyEvent, crypto]);

  const handleSelectRow = useCallback((result: StrikeOptResult, match: OptMatchResult) => {
    setSelectedResult(result);
    setSelectedMatch(match);
    // Scroll to chart section after render
    setTimeout(() => {
      chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  // Load polymarket event + option expiry from a snapshot JSON
  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    readJsonFile(file)
      .then((raw) => {
        const snapshot = parseSnapshot(raw);
        const polyCard = snapshot.cards.find(c => c.kind === 'polymarket');
        const optCard = snapshot.cards.find(c => c.kind === 'options');
        const pd = polyCard?.data as PolymarketCardData | undefined;
        if (!pd?.event) { setError('No polymarket event found in file'); return; }
        const od = optCard?.data as OptionsCardData | undefined;

        const loadedCrypto = pd.crypto ?? snapshot.view?.crypto ?? null;
        const loadedOptionType = pd.optionType ?? snapshot.view?.optionType ?? 'above';
        const expiry = od?.selectedOptions?.[0]?.expiryTimestamp;

        setPolyEvent(pd.event);
        setPolyMarkets(pd.markets ?? []);
        latestPolyMarketsRef.current = pd.markets ?? [];
        setCrypto(loadedCrypto);
        setBybitBase(od?.baseCoin ?? od?.chain?.baseCoin ?? preferredBybitBase(loadedCrypto));
        setOptionType(loadedOptionType);
        latestOptionTypeRef.current = loadedOptionType;
        if (expiry) setLoadedExpiry(expiry);
        setResults([]);
        setSelectedResult(null);
        setSelectedMatch(null);

        if (loadedCrypto) {
          fetchCurrentPrice(loadedCrypto as CryptoOption)
            .then(price => {
              if (price > 0) {
                setSpotPrice(price);
                latestSpotRef.current = price;
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to parse file'));
  }, []);

  // Save: download snapshot JSON + chart PNG
  const handleSave = useCallback(async () => {
    if (!polyEvent || !selectedResult || !selectedMatch) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const label = selectedResult.market.groupItemTitle ?? selectedResult.market.strikePrice;
    const qtyScale = bybitQty / 0.01;
    const scaledPolyQty = Math.round(selectedMatch.polyQty * qtyScale);

    const polyCard: PositionCard = {
      id: 'finder-poly',
      kind: 'polymarket',
      data: {
        event: polyEvent,
        optionType,
        crypto,
        markets: polyMarkets,
        selections: [{
          marketId: selectedResult.market.id,
          side: selectedMatch.hedgeSide,
          quantity: scaledPolyQty,
          entryPrice: selectedMatch.noAskPrice,
        }],
        minimized: false,
      } as PolymarketCardData,
    };
    const optCard: PositionCard = {
      id: 'finder-opts',
      kind: 'options',
      data: {
        baseCoin: bybitBase,
        chain: null,
        selectedOptions: [
          {
            symbol: selectedMatch.instrument.symbol,
            optionsType: selectedMatch.instrument.optionsType,
            strike: selectedMatch.instrument.strike,
            expiryTimestamp: selectedMatch.instrument.expiryTimestamp,
            side: 'buy' as const,
            quantity: bybitQty,
            entryPrice: selectedMatch.bybitAsk,
            markIv: selectedMatch.ticker.markIv,
          },
          {
            symbol: selectedMatch.shortInstrument.symbol,
            optionsType: selectedMatch.shortInstrument.optionsType,
            strike: selectedMatch.shortInstrument.strike,
            expiryTimestamp: selectedMatch.shortInstrument.expiryTimestamp,
            side: 'sell' as const,
            quantity: bybitQty,
            entryPrice: selectedMatch.shortBid,
            markIv: selectedMatch.shortTicker.markIv,
          },
        ],
        minimized: false,
      } as OptionsCardData,
    };

    const snapshot = buildSnapshot('finder', [polyCard, optCard], {
      view: { crypto, optionType, spotPrice },
    });
    downloadJson(snapshot, `finder_${label}_${dateStr}.json`);
    await downloadElementPng(chartRef.current, `finder_${label}_chart_${dateStr}.png`);
  }, [polyEvent, polyMarkets, crypto, optionType, spotPrice, bybitQty, bybitBase, selectedResult, selectedMatch]);

  // Send selected result to Position Builder
  const handleSendToBuilder = useCallback(() => {
    if (!polyEvent || !selectedResult || !selectedMatch) return;

    const qtyScale = bybitQty / 0.01;
    const scaledPolyQty = Math.round(selectedMatch.polyQty * qtyScale);
    const noEntryPrice = selectedMatch.noAskPrice;

    const polySelections = [{
      marketId: selectedResult.market.id,
      side: selectedMatch.hedgeSide as Side,
      quantity: scaledPolyQty,
      entryPrice: noEntryPrice,
    }];

    const bybitSelections = [
      {
        symbol: selectedMatch.instrument.symbol,
        optionsType: selectedMatch.instrument.optionsType,
        strike: selectedMatch.instrument.strike,
        expiryTimestamp: selectedMatch.instrument.expiryTimestamp,
        side: 'buy' as const,
        quantity: bybitQty,
        entryPrice: selectedMatch.bybitAsk,
        markIv: selectedMatch.ticker.markIv,
      },
      {
        symbol: selectedMatch.shortInstrument.symbol,
        optionsType: selectedMatch.shortInstrument.optionsType,
        strike: selectedMatch.shortInstrument.strike,
        expiryTimestamp: selectedMatch.shortInstrument.expiryTimestamp,
        side: 'sell' as const,
        quantity: bybitQty,
        entryPrice: selectedMatch.shortBid,
        markIv: selectedMatch.shortTicker.markIv,
      },
    ];

    const bybitChainData = bybitChain ? {
      baseCoin: bybitChain.baseCoin ?? bybitBase,
      expiryLabel: bybitChain.expiryLabel,
      expiryTimestamp: bybitChain.expiryTimestamp,
      instruments: bybitChain.instruments as BybitInstrument[],
      tickers: Array.from(bybitChain.tickers.values()) as BybitTicker[],
    } : null;

    onSendToBuilder({
      version: '1.0',
      polyEvent,
      polyMarkets,
      polySelections,
      bybitChainData,
      bybitSelections,
      crypto,
      optionType,
      spotPrice,
    });
  }, [polyEvent, polyMarkets, bybitChain, bybitBase, crypto, optionType, spotPrice,
      selectedResult, selectedMatch, bybitQty, onSendToBuilder]);

  const canRun = polyMarkets.length > 0 && bybitChain !== null && spotPrice > 0;
  const hasResults = results.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top toolbar: Refresh / Load / Save */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <input ref={uploadRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
        <Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={14} /> : <Refresh />} onClick={handleRefresh} disabled={!canRun || loading}>
          Refresh
        </Button>
        <Button size="small" variant="outlined" startIcon={<Upload />} onClick={() => uploadRef.current?.click()}>
          Load
        </Button>
        <Button size="small" variant="outlined" startIcon={<SaveAlt />} onClick={handleSave} disabled={!selectedResult || !polyEvent}>
          Save
        </Button>
      </Box>

      {/* Full-width chart section */}
      {selectedResult && selectedMatch && (
        <Paper ref={chartSectionRef} sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {selectedResult.market.groupItemTitle}
              </Typography>
              <Chip label={`×${bybitQty} ${bybitBase}`} size="small" />
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<Send />}
                onClick={handleSendToBuilder}
                disabled={!polyEvent}
              >
                Send to Builder
              </Button>
            </Box>
          </Box>
          <div ref={chartRef}>
            <VizCard
              result={selectedResult}
              match={selectedMatch}
              spotPrice={spotPrice}
              optionType={optionType}
              nowSec={nowSec}
              smile={smile}
              bybitQty={bybitQty}
            />
          </div>
        </Paper>
      )}

      {/* Polymarket + Bybit Options side by side, equal height */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'stretch' }}>
        <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h6" fontWeight={600}>Polymarket Event</Typography>
          <PolymarketSearch onEventLoaded={handleEventLoaded} eventSlug={polyEvent?.slug} />
          {polyEvent && (
            <Box>
              <Typography variant="body2" fontWeight={600}>{polyEvent.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {polyMarkets.length} markets · {optionType} · {crypto ?? 'unknown'}
              </Typography>
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="h6" fontWeight={600}>Bybit Options</Typography>
            <Tooltip title="Real-time data from Bybit V5 API. Mark price and implied volatility (markIv) are used in Black-Scholes to score and rank option candidates. Selected positions are transferred to the Builder with live Bybit prices." arrow>
              <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
            </Tooltip>
          </Box>
          <BybitOptionChain
            onChainSelected={handleChainSelected}
            onSpotPriceLoaded={handleSpotLoaded}
            requestedExpiry={loadedExpiry}
            refreshToken={chainRefreshToken}
            baseCoin={bybitBase}
            onBaseCoinChange={setBybitBase}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <TextField
              label={`Option size (${bybitBase})`}
              size="small"
              type="number"
              value={bybitQty}
              onChange={e => setBybitQty(Math.max(0.001, parseFloat(e.target.value) || 0.01))}
              inputProps={{ min: 0.001, step: 0.01 }}
              sx={{ width: 170 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              Scales chart & Poly qty
            </Typography>
          </Box>
          <TextField
            label={`${crypto ?? bybitBase} spot / reference`}
            size="small"
            type="number"
            value={spotPrice || ''}
            onChange={e => {
              const next = parseFloat(e.target.value) || 0;
              setSpotPrice(next);
              latestSpotRef.current = next;
            }}
            inputProps={{ min: 0, step: 'any' }}
            sx={{ width: 220 }}
          />
          {bybitChain && (
            <Typography variant="caption" color="text.secondary">
              {bybitChain.expiryLabel} · {(bybitChain.instruments.length / 2) | 0} strikes
            </Typography>
          )}
        </Paper>
      </Box>

      {/* Run button */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleRun}
          disabled={!canRun || loading}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
        >
          {loading ? 'Finding…' : 'Find Best Positions'}
        </Button>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ flex: 1 }}>{error}</Alert>}
      </Box>

      {/* Results table */}
      {hasResults && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
            Optimization Results
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              — click a cell to view chart
            </Typography>
          </Typography>
          <FinderTable
            results={results}
            selectedMatch={selectedMatch}
            onSelect={handleSelectRow}
          />
        </Paper>
      )}
    </Box>
  );
}
