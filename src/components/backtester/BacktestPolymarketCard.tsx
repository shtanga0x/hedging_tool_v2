import { useState, useCallback, useEffect, useRef } from 'react';
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
  Chip,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import type {
  BacktestPosition,
  ParsedMarket,
  PolymarketEvent,
  CryptoOption,
  OptionType,
  Side,
} from '../../types';
import { PolymarketSearch } from '../shared/PolymarketSearch';
import { detectEventDisplayType, formatPolyExpiry, fetchEventBySlug, parseMarkets } from '../../api/polymarket';

const POLY_COLOR = '#4A90D9';

type PriceMode = 'bid' | 'mid' | 'ask';

function getEntryPrice(market: { currentPrice: number; bestBid?: number; bestAsk?: number }, side: 'YES' | 'NO', mode: PriceMode): number {
  if (side === 'YES') {
    if (mode === 'ask') return market.bestAsk ?? market.currentPrice;
    if (mode === 'bid') return market.bestBid ?? market.currentPrice;
    return market.currentPrice;
  } else {
    if (mode === 'ask') return 1 - (market.bestBid ?? market.currentPrice);
    if (mode === 'bid') return 1 - (market.bestAsk ?? market.currentPrice);
    return 1 - market.currentPrice;
  }
}

interface StrikeSelection {
  marketId: string;
  side: Side;
  quantity: number;
}

interface BacktestPolymarketCardProps {
  positions: BacktestPosition[];
  groupId: string;
  onUpdatePositions: (groupId: string, positions: BacktestPosition[]) => void;
  onRemove: (groupId: string) => void;
  onMinimize: (groupId: string) => void;
  minimized: boolean;
  colorFor: (idx: number) => string;
  startIndex: number;
}

export function BacktestPolymarketCard({
  positions,
  groupId,
  onUpdatePositions,
  onRemove,
  onMinimize,
  minimized,
  colorFor,
  startIndex,
}: BacktestPolymarketCardProps) {
  const [polyMarkets, setPolyMarkets] = useState<ParsedMarket[]>(() => {
    return [];
  });
  const [polyEvent, setPolyEvent] = useState<PolymarketEvent | null>(null);
  const [polyOptType, setPolyOptType] = useState<'above' | 'hit' | 'price'>('above');
  const [priceMode, setPriceMode] = useState<PriceMode>(() => (positions[0]?.polyPriceMode ?? 'ask'));

  // Auto-load event from positions when component mounts (e.g. after file load)
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (didAutoLoad.current || positions.length === 0) return;
    const slug = positions.find(p => p.polyEventSlug)?.polyEventSlug;
    if (!slug) return;
    didAutoLoad.current = true;
    fetchEventBySlug(slug)
      .then(event => {
        const markets = parseMarkets(event.markets);
        setPolyEvent(event);
        setPolyMarkets(markets);
        setPolyOptType(detectEventDisplayType(event));
        // Reconstruct selections from loaded positions
        const newSels = new Map<string, StrikeSelection>();
        for (const pos of positions) {
          if (!pos.tokenId || !pos.polySide) continue;
          const market = markets.find(m =>
            pos.polySide === 'YES' ? m.yesTokenId === pos.tokenId : m.noTokenId === pos.tokenId
          );
          if (!market) continue;
          newSels.set(`${market.id}-${pos.polySide}`, {
            marketId: market.id,
            side: pos.polySide as Side,
            quantity: pos.quantity ?? 100,
          });
        }
        setStrikeSelections(newSels);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [strikeSelections, setStrikeSelections] = useState<Map<string, StrikeSelection>>(() => {
    // Reconstruct selections from existing positions
    const map = new Map<string, StrikeSelection>();
    for (const pos of positions) {
      if (pos.tokenId && pos.polySide) {
        // We don't know the marketId from existing positions, but it's ok for display
      }
    }
    return map;
  });

  const handleEventLoaded = useCallback((
    event: PolymarketEvent,
    markets: ParsedMarket[],
    _crypto: CryptoOption | null,
    _optionType: OptionType,
  ) => {
    setPolyEvent(event);
    setPolyMarkets(markets);
    setPolyOptType(detectEventDisplayType(event));

    // Build positions from all markets (no auto-select, just make them available)
    // Clear old selections
    setStrikeSelections(new Map());
  }, []);

  const toggleSide = (market: ParsedMarket, side: Side) => {
    const key = `${market.id}-${side}`;
    setStrikeSelections(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, { marketId: market.id, side, quantity: 100 });
      }
      // Rebuild positions from selections
      rebuildPositions(next, polyMarkets, polyOptType, polyEvent, priceMode);
      return next;
    });
  };

  const updateSelQty = (marketId: string, side: Side, quantity: number) => {
    const key = `${marketId}-${side}`;
    setStrikeSelections(prev => {
      const next = new Map(prev);
      const existing = next.get(key);
      if (existing) next.set(key, { ...existing, quantity });
      rebuildPositions(next, polyMarkets, polyOptType, polyEvent, priceMode);
      return next;
    });
  };

  const rebuildPositions = (
    sels: Map<string, StrikeSelection>,
    markets: ParsedMarket[],
    optType: string,
    event: PolymarketEvent | null,
    mode: PriceMode,
  ) => {
    const newPositions: BacktestPosition[] = [];
    let idx = 0;
    for (const [, sel] of sels) {
      const market = markets.find(m => m.id === sel.marketId);
      if (!market) continue;
      const tokenId = sel.side === 'YES' ? market.yesTokenId : market.noTokenId;
      const expiry = market.endDate ? ` \u00b7 exp ${formatPolyExpiry(market.endDate)}` : '';
      newPositions.push({
        id: positions[idx]?.id || `${groupId}-${idx}`,
        kind: 'polymarket',
        label: `${sel.side} ${market.groupItemTitle || String(market.strikePrice)} \u00b7 ${optType}${expiry}`,
        color: colorFor(startIndex + idx),
        tokenId,
        polySide: sel.side,
        quantity: sel.quantity,
        entryTimestamp: 0,
        entryPrice: getEntryPrice(market, sel.side, mode),
        polyPriceMode: mode,
        polyEventSlug: event?.slug,
      });
      idx++;
    }
    onUpdatePositions(groupId, newPositions);
  };

  const eventTitle = polyEvent?.title;
  const selCount = strikeSelections.size;

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Polymarket</Typography>
            {eventTitle && (
              <Chip label={eventTitle} size="small" sx={{ bgcolor: POLY_COLOR, color: '#fff', maxWidth: 400 }} />
            )}
            {selCount > 0 && (
              <Chip label={`${selCount} leg${selCount > 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" />
            )}
          </Box>
        }
        action={
          <Box>
            <IconButton size="small" onClick={() => onMinimize(groupId)}>
              {minimized ? <ExpandMore /> : <ExpandLess />}
            </IconButton>
            <IconButton size="small" onClick={() => onRemove(groupId)} color="error">
              <Delete />
            </IconButton>
          </Box>
        }
        sx={{ pb: minimized ? 0 : undefined }}
      />
      {!minimized && (
        <CardContent sx={{ pt: 1 }}>
          {/* Compact loaded-position summary (shown when positions exist from file load) */}
          {positions.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
              {positions.map((pos, i) => (
                <Chip
                  key={i}
                  label={`● ${pos.polySide ?? ''} ${pos.label.split(' · ')[0].replace(/^(YES|NO)\s+/, '')} ×${pos.quantity ?? 0}${pos.entryPrice > 0 ? ` @ ${(pos.entryPrice * 100).toFixed(1)}¢` : ''}`}
                  size="small"
                  sx={{ bgcolor: '#4A90D9', color: '#fff', fontFamily: 'monospace', fontSize: '0.72rem' }}
                />
              ))}
            </Box>
          )}
          <PolymarketSearch onEventLoaded={handleEventLoaded} />

          {polyEvent && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Event: <strong>{polyEvent.title}</strong> — expires {new Date(polyEvent.endDate * 1000).toLocaleDateString()}
            </Typography>
          )}

          {polyMarkets.length > 0 && (
            <>
              {/* Price mode toggle */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Entry price:</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={priceMode}
                  onChange={(_, v) => {
                    if (!v) return;
                    setPriceMode(v);
                    // Rebuild all active selections with the new mode
                    rebuildPositions(strikeSelections, polyMarkets, polyOptType, polyEvent, v);
                  }}
                  sx={{ height: 26 }}
                >
                  <ToggleButton value="bid" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', color: '#EF4444', '&.Mui-selected': { bgcolor: 'rgba(239,68,68,0.12)', color: '#EF4444' } }}>Bid</ToggleButton>
                  <ToggleButton value="mid" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', '&.Mui-selected': { bgcolor: 'rgba(139,157,195,0.15)' } }}>Mid</ToggleButton>
                  <ToggleButton value="ask" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', color: '#22C55E', '&.Mui-selected': { bgcolor: 'rgba(34,197,94,0.12)', color: '#22C55E' } }}>Ask</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                  {priceMode === 'bid' ? '(limit order · 0 fee)' : priceMode === 'mid' ? '(mid · taker fee)' : '(market order · taker fee)'}
                </Typography>
              </Box>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Strike</TableCell>
                    <TableCell align="right">YES p</TableCell>
                    <TableCell padding="checkbox" align="center">YES</TableCell>
                    <TableCell sx={{ minWidth: 72 }}>YES qty</TableCell>
                    <TableCell align="right">NO p</TableCell>
                    <TableCell padding="checkbox" align="center">NO</TableCell>
                    <TableCell sx={{ minWidth: 72 }}>NO qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {polyMarkets.map(market => {
                    const yesSel = strikeSelections.get(`${market.id}-YES`);
                    const noSel = strikeSelections.get(`${market.id}-NO`);
                    const isActive = !!(yesSel || noSel);
                    const yesP = getEntryPrice(market, 'YES', priceMode);
                    const noP  = getEntryPrice(market, 'NO',  priceMode);
                    return (
                      <TableRow key={market.id} selected={isActive} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={isActive ? 600 : 400}>
                            {market.groupItemTitle || market.strikePrice.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'success.main', whiteSpace: 'nowrap' }}>
                          {(yesP * 100).toFixed(1)}&cent;
                        </TableCell>
                        <TableCell padding="checkbox" align="center">
                          <Checkbox
                            checked={!!yesSel}
                            onChange={() => toggleSide(market, 'YES')}
                            size="small"
                            color="success"
                          />
                        </TableCell>
                        <TableCell>
                          {yesSel && (
                            <TextField
                              size="small"
                              type="number"
                              value={Math.round(yesSel.quantity)}
                              onChange={e => updateSelQty(market.id, 'YES', Math.max(0, Math.round(parseFloat(e.target.value)) || 0))}
                              sx={{ width: 72 }}
                              inputProps={{ min: 0, step: 1 }}
                            />
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'warning.main', whiteSpace: 'nowrap' }}>
                          {(noP * 100).toFixed(1)}&cent;
                        </TableCell>
                        <TableCell padding="checkbox" align="center">
                          <Checkbox
                            checked={!!noSel}
                            onChange={() => toggleSide(market, 'NO')}
                            size="small"
                            color="warning"
                          />
                        </TableCell>
                        <TableCell>
                          {noSel && (
                            <TextField
                              size="small"
                              type="number"
                              value={Math.round(noSel.quantity)}
                              onChange={e => updateSelQty(market.id, 'NO', Math.max(0, Math.round(parseFloat(e.target.value)) || 0))}
                              sx={{ width: 72 }}
                              inputProps={{ min: 0, step: 1 }}
                            />
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

          {selCount > 0 && (
            <Typography variant="caption" color="primary" sx={{ mt: 1, display: 'block' }}>
              {selCount} leg{selCount > 1 ? 's' : ''} selected — entry price = first available historical price
            </Typography>
          )}
        </CardContent>
      )}
    </Card>
  );
}
