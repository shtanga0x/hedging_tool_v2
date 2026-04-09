import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
  Chip,
} from '@mui/material';
import type {
  ParsedMarket,
  OptionType,
  BybitOptionChain as BybitChainType,
  CryptoOption,
  PolymarketCardData,
  OptionsCardData,
} from '../../types';
import { runOptimization } from '../../optimization/optimizer';

interface HedgeItPanelProps {
  open: boolean;
  onClose: () => void;
  market: ParsedMarket;
  optionType: OptionType;
  spotPrice: number;
  nowSec: number;
  bybitChain: BybitChainType;
  crypto: CryptoOption | null;
  side: 'YES' | 'NO';
  onAddPositions: (
    polySelection: PolymarketCardData['selections'][0],
    longOpt: OptionsCardData['selectedOptions'][0],
    shortOpt: OptionsCardData['selectedOptions'][0],
  ) => void;
}

export function HedgeItPanel({
  open,
  onClose,
  market,
  optionType,
  spotPrice,
  nowSec,
  bybitChain,
  side,
  onAddPositions,
}: HedgeItPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const result = useMemo(() => {
    if (!open || !bybitChain || spotPrice <= 0) return null;
    try {
      const results = runOptimization([market], optionType, spotPrice, nowSec, bybitChain, 0.01, side);
      return results[0] ?? null;
    } catch {
      return null;
    }
  }, [open, market, optionType, spotPrice, nowSec, bybitChain, side]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const best = result?.best10 ?? result?.best1 ?? result?.best20;

  const handleAdd = () => {
    if (!best || !result) return;

    const polySelection: PolymarketCardData['selections'][0] = {
      marketId: market.id,
      side,
      quantity: Math.round(best.polyQty),
      entryPrice: best.noAskPrice,
    };

    const longOpt: OptionsCardData['selectedOptions'][0] = {
      symbol: best.instrument.symbol,
      optionsType: best.instrument.optionsType,
      strike: best.instrument.strike,
      expiryTimestamp: best.instrument.expiryTimestamp,
      side: 'buy',
      quantity: 0.01,
      entryPrice: best.bybitAsk,
      markIv: best.ticker.markIv,
    };

    const shortOpt: OptionsCardData['selectedOptions'][0] = {
      symbol: best.shortInstrument.symbol,
      optionsType: best.shortInstrument.optionsType,
      strike: best.shortInstrument.strike,
      expiryTimestamp: best.shortInstrument.expiryTimestamp,
      side: 'sell',
      quantity: 0.01,
      entryPrice: best.shortBid,
      markIv: best.shortTicker.markIv,
    };

    onAddPositions(polySelection, longOpt, shortOpt);
    onClose();
  };

  const sideColor = side === 'YES' ? 'success' : 'warning';
  const optLabel = side === 'YES'
    ? (best ? `${best.instrument.optionsType} spread` : '')
    : (best ? `${best.instrument.optionsType} spread` : '');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Hedge {side} — {market.groupItemTitle || market.strikePrice.toLocaleString()}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {!error && (
          <>
            {!best ? (
              <Alert severity="warning">No feasible hedge found for this market.</Alert>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Best 3-leg hedge (±10% range) — {optLabel}:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    label={`Poly ${side} ×${Math.round(best.polyQty)} @ ${(best.noAskPrice * 100).toFixed(1)}¢`}
                    color={sideColor}
                    size="small"
                  />
                  <Chip
                    label={`Long ${best.instrument.symbol} @ $${best.bybitAsk.toFixed(2)}`}
                    color="primary"
                    size="small"
                  />
                  <Chip
                    label={`Short ${best.shortInstrument.symbol} @ $${best.shortBid.toFixed(2)}`}
                    color="secondary"
                    size="small"
                  />
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Avg P&L ±1%</Typography>
                    <Typography variant="body2" color={best.avgPnl1 >= 0 ? 'success.main' : 'error.main'}>
                      {best.avgPnl1 >= 0 ? '+' : ''}{best.avgPnl1.toFixed(1)}%
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Avg P&L ±10%</Typography>
                    <Typography variant="body2" color={best.avgPnl10 >= 0 ? 'success.main' : 'error.main'}>
                      {best.avgPnl10 >= 0 ? '+' : ''}{best.avgPnl10.toFixed(1)}%
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Avg P&L ±20%</Typography>
                    <Typography variant="body2" color={best.avgPnl20 >= 0 ? 'success.main' : 'error.main'}>
                      {best.avgPnl20 >= 0 ? '+' : ''}{best.avgPnl20.toFixed(1)}%
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {best && (
          <Button variant="contained" onClick={handleAdd}>
            Add to Builder
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
