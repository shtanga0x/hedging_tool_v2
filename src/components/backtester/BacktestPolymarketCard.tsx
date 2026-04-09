import { useState, useCallback } from 'react';
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
import { detectEventDisplayType, formatPolyExpiry } from '../../api/polymarket';

const POLY_COLOR = '#4A90D9';

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
    // Reconstruct from existing positions if they have data
    return [];
  });
  const [polyEvent, setPolyEvent] = useState<PolymarketEvent | null>(null);
  const [polyOptType, setPolyOptType] = useState<'above' | 'hit' | 'price'>('above');
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
      rebuildPositions(next, polyMarkets, polyOptType, polyEvent);
      return next;
    });
  };

  const updateSelQty = (marketId: string, side: Side, quantity: number) => {
    const key = `${marketId}-${side}`;
    setStrikeSelections(prev => {
      const next = new Map(prev);
      const existing = next.get(key);
      if (existing) next.set(key, { ...existing, quantity });
      rebuildPositions(next, polyMarkets, polyOptType, polyEvent);
      return next;
    });
  };

  const rebuildPositions = (
    sels: Map<string, StrikeSelection>,
    markets: ParsedMarket[],
    optType: string,
    event: PolymarketEvent | null,
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
        entryPrice: 0,
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
          <PolymarketSearch onEventLoaded={handleEventLoaded} />

          {polyEvent && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Event: <strong>{polyEvent.title}</strong> — expires {new Date(polyEvent.endDate * 1000).toLocaleDateString()}
            </Typography>
          )}

          {polyMarkets.length > 0 && (
            <Box sx={{ overflowX: 'auto', mt: 1 }}>
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
                    const yesAsk = market.bestAsk ?? market.currentPrice;
                    const noAsk = market.bestBid != null ? 1 - market.bestBid : 1 - market.currentPrice;
                    return (
                      <TableRow key={market.id} selected={isActive} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={isActive ? 600 : 400}>
                            {market.groupItemTitle || market.strikePrice.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'success.main', whiteSpace: 'nowrap' }}>
                          {(yesAsk * 100).toFixed(1)}&cent;
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
                          {(noAsk * 100).toFixed(1)}&cent;
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
