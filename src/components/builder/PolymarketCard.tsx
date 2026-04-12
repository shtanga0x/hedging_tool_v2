import { useState, useCallback, useEffect } from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  IconButton,
  Typography,
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Checkbox,
  TextField,
  Button,
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import type {
  PolymarketCardData,
  OptionsCardData,
  PolymarketEvent,
  ParsedMarket,
  CryptoOption,
  OptionType,
  Side,
  BybitOptionChain as BybitChainType,
} from '../../types';
import { PolymarketSearch } from '../shared/PolymarketSearch';
import { HedgeItPanel } from './HedgeItPanel';
import { fetchEventBySlug, parseMarkets, detectEventDisplayType, formatPolyExpiry } from '../../api/polymarket';

const POLY_COLOR = '#4A90D9'; // polymarket blue

type PriceMode = 'bid' | 'mid' | 'ask';

interface PolymarketCardProps {
  id: string;
  data: PolymarketCardData;
  spotPrice: number;
  bybitChain: BybitChainType | null;
  nowSec: number;
  onUpdate: (id: string, data: PolymarketCardData) => void;
  onRemove: (id: string) => void;
  onMinimize: (id: string) => void;
  onAddHedgeLegs: (longOpt: OptionsCardData['selectedOptions'][0], shortOpt: OptionsCardData['selectedOptions'][0]) => void;
  refreshToken?: number;
}

function getEntryPrice(market: ParsedMarket, side: Side, mode: PriceMode): number {
  if (side === 'YES') {
    if (mode === 'ask') return market.bestAsk ?? market.currentPrice;
    if (mode === 'bid') return market.bestBid ?? market.currentPrice;
    return market.currentPrice;
  } else {
    // Buying NO: NO ask = 1 − YES bid; NO bid = 1 − YES ask; NO mid = 1 − YES mid
    if (mode === 'ask') return 1 - (market.bestBid ?? market.currentPrice);
    if (mode === 'bid') return 1 - (market.bestAsk ?? market.currentPrice);
    return 1 - market.currentPrice;
  }
}

function getDisplayPrice(market: ParsedMarket, side: Side, mode: PriceMode): number {
  return getEntryPrice(market, side, mode);
}

export function PolymarketCard({
  id,
  data,
  spotPrice,
  bybitChain,
  nowSec,
  onUpdate,
  onRemove,
  onMinimize,
  onAddHedgeLegs,
  refreshToken,
}: PolymarketCardProps) {
  const [hedgeMarket, setHedgeMarket] = useState<ParsedMarket | null>(null);
  const [hedgeSide, setHedgeSide] = useState<'YES' | 'NO'>('NO');
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [priceMode, setPriceMode] = useState<PriceMode>(data.priceMode ?? 'ask');
  const [reloading, setReloading] = useState(false);

  const update = useCallback((patch: Partial<PolymarketCardData>) => {
    onUpdate(id, { ...data, ...patch });
  }, [id, data, onUpdate]);

  // Re-fetch live prices when refresh is triggered
  useEffect(() => {
    if (!refreshToken || !data.event?.slug) return;
    let cancelled = false;
    setReloading(true);
    fetchEventBySlug(data.event.slug)
      .then(freshEvent => {
        if (cancelled) return;
        const freshMarkets = parseMarkets(freshEvent.markets);
        // Preserve selections entry prices by updating market currentPrice/bestBid/bestAsk only
        update({
          markets: freshMarkets,
          selections: data.selections.map(sel => {
            const m = freshMarkets.find(fm => fm.id === sel.marketId);
            if (!m) return sel;
            const entryPrice = sel.side === 'YES'
              ? (priceMode === 'ask' ? (m.bestAsk ?? m.currentPrice) : priceMode === 'bid' ? (m.bestBid ?? m.currentPrice) : m.currentPrice)
              : (priceMode === 'ask' ? 1 - (m.bestBid ?? m.currentPrice) : priceMode === 'bid' ? 1 - (m.bestAsk ?? m.currentPrice) : 1 - m.currentPrice);
            return { ...sel, entryPrice };
          }),
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReloading(false); });
    return () => { cancelled = true; };
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEventLoaded = useCallback((
    event: PolymarketEvent,
    markets: ParsedMarket[],
    crypto: CryptoOption | null,
    optionType: OptionType,
  ) => {
    setLoadingEvent(false);
    update({ event, markets, crypto, optionType, selections: [] });
  }, [update]);

  // Return the selection for a given (marketId, side), or undefined
  const getSel = (marketId: string, side: Side) =>
    data.selections.find(s => s.marketId === marketId && s.side === side);

  // Return qty shared by all selections for this market (from first match)
  const getRowQty = (marketId: string): number => {
    const sel = data.selections.find(s => s.marketId === marketId);
    return sel?.quantity ?? 100;
  };

  const toggleSide = (market: ParsedMarket, side: Side) => {
    const existing = getSel(market.id, side);
    if (existing) {
      update({ selections: data.selections.filter(s => !(s.marketId === market.id && s.side === side)) });
    } else {
      const entryPrice = getEntryPrice(market, side, priceMode);
      const qty = getRowQty(market.id);
      update({
        selections: [...data.selections, { marketId: market.id, side, quantity: qty, entryPrice }],
      });
    }
  };

  // Update qty for ALL selections at this market to the same value
  const updateRowQty = (marketId: string, quantity: number) => {
    update({
      selections: data.selections.map(s =>
        s.marketId === marketId ? { ...s, quantity } : s
      ),
    });
  };

  // When price mode changes, update entry prices of all existing selections and persist mode
  const handlePriceModeChange = (newMode: PriceMode) => {
    setPriceMode(newMode);
    update({
      priceMode: newMode,
      selections: data.selections.map(s => {
        const market = data.markets.find(m => m.id === s.marketId);
        if (!market) return s;
        return { ...s, entryPrice: getEntryPrice(market, s.side, newMode) };
      }),
    });
  };

  const selectedCount = data.selections.length;

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Polymarket Position</Typography>
            {data.event && (
              <Chip
                label={data.event.title.length > 40
                  ? data.event.title.slice(0, 40) + '...'
                  : data.event.title}
                size="small"
              />
            )}
            {data.event && (
              <Chip
                label={detectEventDisplayType(data.event)}
                size="small"
                variant="outlined"
              />
            )}
            {data.event && data.event.endDate > 0 && (
              <Chip
                label={`exp ${formatPolyExpiry(data.event.endDate)}`}
                size="small"
                variant="outlined"
              />
            )}
            {selectedCount > 0 && (
              <Chip label={`● ${selectedCount} leg${selectedCount > 1 ? 's' : ''}`} size="small" sx={{ bgcolor: POLY_COLOR, color: '#fff' }} />
            )}
            {reloading && <CircularProgress size={14} />}
          </Box>
        }
        action={
          <Box>
            <IconButton size="small" onClick={() => onMinimize(id)}>
              {data.minimized ? <ExpandMore /> : <ExpandLess />}
            </IconButton>
            <IconButton size="small" onClick={() => onRemove(id)} color="error">
              <Delete />
            </IconButton>
          </Box>
        }
        sx={{ pb: data.minimized ? 0 : undefined }}
      />
      {!data.minimized && (
        <CardContent sx={{ pt: 1 }}>
          <PolymarketSearch onEventLoaded={handleEventLoaded} loading={loadingEvent} eventSlug={data.event?.slug} />

          {data.markets.length > 0 && (
            <>
              {/* Price mode toggle */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Entry price:</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={priceMode}
                  onChange={(_, v) => { if (v) handlePriceModeChange(v); }}
                  sx={{ height: 26 }}
                >
                  <ToggleButton value="bid" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', color: '#EF4444', '&.Mui-selected': { bgcolor: 'rgba(239,68,68,0.12)', color: '#EF4444' } }}>Bid</ToggleButton>
                  <ToggleButton value="mid" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', '&.Mui-selected': { bgcolor: 'rgba(139,157,195,0.15)' } }}>Mid</ToggleButton>
                  <ToggleButton value="ask" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', color: '#22C55E', '&.Mui-selected': { bgcolor: 'rgba(34,197,94,0.12)', color: '#22C55E' } }}>Ask</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Strike</TableCell>
                      <TableCell align="right">YES p</TableCell>
                      <TableCell padding="checkbox" align="center">YES</TableCell>
                      <TableCell align="right">NO p</TableCell>
                      <TableCell padding="checkbox" align="center">NO</TableCell>
                      <TableCell sx={{ minWidth: 80 }}>Size</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.markets.map(market => {
                      const yesSel = getSel(market.id, 'YES');
                      const noSel = getSel(market.id, 'NO');
                      const isActive = !!(yesSel || noSel);
                      const rowQty = getRowQty(market.id);
                      return (
                        <TableRow key={market.id} selected={isActive} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={isActive ? 600 : 400}>
                              {market.groupItemTitle || market.strikePrice.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main', whiteSpace: 'nowrap' }}>
                            {(getDisplayPrice(market, 'YES', priceMode) * 100).toFixed(1)}¢
                          </TableCell>
                          <TableCell padding="checkbox" align="center">
                            <Checkbox
                              checked={!!yesSel}
                              onChange={() => toggleSide(market, 'YES')}
                              size="small"
                              sx={{ color: POLY_COLOR, '&.Mui-checked': { color: POLY_COLOR } }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'warning.main', whiteSpace: 'nowrap' }}>
                            {(getDisplayPrice(market, 'NO', priceMode) * 100).toFixed(1)}¢
                          </TableCell>
                          <TableCell padding="checkbox" align="center">
                            <Checkbox
                              checked={!!noSel}
                              onChange={() => toggleSide(market, 'NO')}
                              size="small"
                              sx={{ color: POLY_COLOR, '&.Mui-checked': { color: POLY_COLOR } }}
                            />
                          </TableCell>
                          <TableCell>
                            {isActive && (
                              <TextField
                                size="small"
                                type="number"
                                value={Math.round(rowQty)}
                                onChange={e => updateRowQty(market.id, Math.max(0, Math.round(parseFloat(e.target.value)) || 0))}
                                sx={{ width: 80 }}
                                inputProps={{ min: 0, step: 1 }}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {bybitChain && (
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                <Button
                                  size="small"
                                  variant={yesSel ? 'contained' : 'outlined'}
                                  color="success"
                                  onClick={() => { setHedgeSide('YES'); setHedgeMarket(market); }}
                                  sx={{ fontSize: 10, py: 0.2, px: 0.75, minWidth: 0, whiteSpace: 'nowrap' }}
                                >
                                  H.YES
                                </Button>
                                <Button
                                  size="small"
                                  variant={noSel ? 'contained' : 'outlined'}
                                  color="warning"
                                  onClick={() => { setHedgeSide('NO'); setHedgeMarket(market); }}
                                  sx={{ fontSize: 10, py: 0.2, px: 0.75, minWidth: 0, whiteSpace: 'nowrap' }}
                                >
                                  H.NO
                                </Button>
                              </Box>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}
          {loadingEvent && <CircularProgress size={20} sx={{ mt: 1 }} />}
        </CardContent>
      )}
      {hedgeMarket && bybitChain && data.crypto && (
        <HedgeItPanel
          open={!!hedgeMarket}
          onClose={() => setHedgeMarket(null)}
          market={hedgeMarket}
          optionType={data.optionType}
          spotPrice={spotPrice}
          nowSec={nowSec}
          bybitChain={bybitChain}
          crypto={data.crypto}
          side={hedgeSide}
          onAddPositions={(polySelection, longOpt, shortOpt) => {
            update({
              selections: [
                ...data.selections.filter(s => !(s.marketId === polySelection.marketId && s.side === polySelection.side)),
                polySelection,
              ],
            });
            onAddHedgeLegs(longOpt, shortOpt);
          }}
        />
      )}
    </Card>
  );
}
