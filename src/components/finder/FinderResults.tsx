import { useState, useMemo } from 'react';
import {
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
  Chip,
  Slider,
  Tooltip,
} from '@mui/material';
import type {
  StrikeOptResult,
  OptMatchResult,
  OptionType,
  PolymarketPosition,
  BybitPosition,
} from '../../types';
import { ProjectionChart } from '../shared/ProjectionChart';
import { usePortfolioCurves } from '../../hooks/usePortfolioCurves';
import { autoH, polyFeePerShare, type SmilePoint } from '../../pricing/engine';
import { formatPolyExpiry } from '../../api/polymarket';

const POLY_COLOR = '#4A90D9'; // polymarket blue
const OPT_COLOR  = '#FF8C00'; // options orange

interface ClickablePnlCellProps {
  match: OptMatchResult | null;
  value: number | null | undefined;
  isSelected: boolean;
  onClick: () => void;
}

function ClickablePnlCell({ match, value, isSelected, onClick }: ClickablePnlCellProps) {
  if (!match || value === null || value === undefined) {
    return <TableCell sx={{ color: 'text.disabled' }}>—</TableCell>;
  }
  const color = value >= 0 ? '#22C55E' : '#EF4444';
  return (
    <TableCell
      onClick={onClick}
      sx={{
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        border: isSelected ? `2px solid ${color}` : undefined,
        borderRadius: 1,
        bgcolor: isSelected ? `${color}22` : undefined,
        '&:hover': { bgcolor: `${color}18` },
      }}
    >
      {value >= 0 ? '+' : ''}{value.toFixed(1)}%
    </TableCell>
  );
}

interface FinderTableProps {
  results: StrikeOptResult[];
  selectedMatch: OptMatchResult | null;
  onSelect: (result: StrikeOptResult, match: OptMatchResult) => void;
}

export function FinderTable({ results, selectedMatch, onSelect }: FinderTableProps) {
  if (results.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No results yet. Run the optimization to see results.
      </Typography>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Strike</TableCell>
            <TableCell>Dir</TableCell>
            <TableCell>
              <Tooltip
                title={
                  <Typography variant="caption">
                    <strong>Implied Volatility (IV)</strong> — the annualized volatility calibrated from the Polymarket YES price using a barrier-option pricing model (Brent&apos;s method). Higher IV means the market prices in larger expected price swings. Used to match and price the Bybit hedge leg.
                  </Typography>
                }
                arrow
                placement="top"
              >
                <span style={{ cursor: 'help', borderBottom: '1px dashed currentColor' }}>IV</span>
              </Tooltip>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>±1% P&L</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>±10% P&L</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>±20% P&L</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {results.map(r => {
            const hasAny = r.best1 || r.best10 || r.best20;
            return (
              <TableRow key={r.market.id} sx={{ '& td': { borderBottom: '1px solid', borderColor: 'divider' } }}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {r.market.groupItemTitle || r.market.strikePrice.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(r.market.currentPrice * 100).toFixed(1)}c YES
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={r.isUpBarrier ? 'UP' : 'DOWN'} size="small" color={r.isUpBarrier ? 'primary' : 'secondary'} />
                </TableCell>
                <TableCell>{r.polyIv > 0 ? `${(r.polyIv * 100).toFixed(1)}%` : '—'}</TableCell>
                {!hasAny ? (
                  <TableCell colSpan={3} sx={{ color: 'text.disabled', fontStyle: 'italic', opacity: 0.45 }}>
                    no feasible hedge
                  </TableCell>
                ) : (
                  <>
                    <ClickablePnlCell
                      match={r.best1}
                      value={r.best1?.avgPnl1}
                      isSelected={selectedMatch === r.best1 && r.best1 !== null}
                      onClick={() => r.best1 && onSelect(r, r.best1)}
                    />
                    <ClickablePnlCell
                      match={r.best10}
                      value={r.best10?.avgPnl10}
                      isSelected={selectedMatch === r.best10 && r.best10 !== null}
                      onClick={() => r.best10 && onSelect(r, r.best10)}
                    />
                    <ClickablePnlCell
                      match={r.best20}
                      value={r.best20?.avgPnl20}
                      isSelected={selectedMatch === r.best20 && r.best20 !== null}
                      onClick={() => r.best20 && onSelect(r, r.best20)}
                    />
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

export function VizCard({
  result,
  match,
  spotPrice,
  optionType,
  nowSec,
  smile,
  bybitQty,
}: {
  result: StrikeOptResult;
  match: OptMatchResult;
  spotPrice: number;
  optionType: OptionType;
  nowSec: number;
  smile: SmilePoint[];
  bybitQty: number;
}) {
  const { market, isUpBarrier, polyIv } = result;
  const { polyQty, noAskPrice, bybitAsk, bybitFee, shortBid, shortFee, instrument, ticker, shortInstrument, shortTicker } = match;

  const sliderBounds: [number, number] = useMemo(() => {
    const prices = [market.strikePrice, instrument.strike, shortInstrument.strike, spotPrice];
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const pad = Math.max((maxP - minP) * 0.5, spotPrice * 0.3);
    return [Math.max(0, Math.floor((minP - pad) / 1000) * 1000), Math.ceil((maxP + pad) / 1000) * 1000];
  }, [market.strikePrice, instrument.strike, shortInstrument.strike, spotPrice]);

  const [priceRange, setPriceRange] = useState<[number, number]>(sliderBounds);

  const YEAR_SEC = 365.25 * 24 * 3600;
  const tauPoly = Math.max((market.endDate - nowSec) / YEAR_SEC, 0);
  const H = autoH(tauPoly);
  const qtyScale = bybitQty / 0.01;
  const scaledPolyQty = polyQty * qtyScale;

  const polyPositions = useMemo((): PolymarketPosition[] => [{
    marketId: market.id,
    question: market.question,
    groupItemTitle: market.groupItemTitle,
    strikePrice: market.strikePrice,
    side: match.hedgeSide === 'YES' ? 'YES' : 'NO',
    entryPrice: noAskPrice,
    impliedVol: polyIv,
    isUpBarrier,
    quantity: scaledPolyQty,
    entryFee: polyFeePerShare(noAskPrice) * scaledPolyQty,
    optionType,
    endDate: market.endDate,
  }], [market, noAskPrice, polyIv, isUpBarrier, scaledPolyQty, match.hedgeSide, optionType]);

  const bybitPositions = useMemo((): BybitPosition[] => [
    { symbol: instrument.symbol, optionsType: instrument.optionsType, strike: instrument.strike, expiryTimestamp: instrument.expiryTimestamp, side: 'buy', entryPrice: bybitAsk, markIv: ticker.markIv, quantity: bybitQty, entryFee: bybitFee * qtyScale },
    { symbol: shortInstrument.symbol, optionsType: shortInstrument.optionsType, strike: shortInstrument.strike, expiryTimestamp: shortInstrument.expiryTimestamp, side: 'sell', entryPrice: shortBid, markIv: shortTicker.markIv, quantity: bybitQty, entryFee: shortFee * qtyScale },
  ], [instrument, ticker, shortInstrument, shortTicker, bybitAsk, bybitFee, shortBid, shortFee, bybitQty, qtyScale]);

  const curves = usePortfolioCurves({
    polyPositions,
    bybitPositions,
    lowerPrice: priceRange[0],
    upperPrice: priceRange[1],
    polyTauNow: tauPoly,
    polyExpiryTs: market.endDate,
    optionType,
    smile: smile.length > 0 ? smile : undefined,
    numPoints: 500,
    spotPrice,
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Chip
          label={`● Poly ${match.hedgeSide} ×${Math.round(polyQty)} @ ${(noAskPrice * 100).toFixed(1)}¢`}
          size="small"
          sx={{ bgcolor: POLY_COLOR, color: '#fff' }}
        />
        <Chip label={optionType} size="small" variant="outlined" />
        <Chip label={`exp ${formatPolyExpiry(market.endDate)}`} size="small" variant="outlined" />
        <Chip label={`● Long ${instrument.symbol} @ $${bybitAsk.toFixed(2)}`} size="small" sx={{ bgcolor: OPT_COLOR, color: '#fff' }} />
        <Chip label={`✕ Short ${shortInstrument.symbol} @ $${shortBid.toFixed(2)}`} size="small" sx={{ bgcolor: OPT_COLOR, color: '#fff' }} />
      </Box>
      <Box sx={{ px: 1, mb: 1 }}>
        <Slider
          value={priceRange}
          onChange={(_, v) => setPriceRange(v as [number, number])}
          min={sliderBounds[0]}
          max={sliderBounds[1]}
          step={1000}
          valueLabelDisplay="auto"
          valueLabelFormat={v => `$${v.toLocaleString()}`}
          size="small"
        />
      </Box>
      <ProjectionChart
        combinedCurves={curves.combinedCurves}
        combinedLabels={curves.combinedLabels}
        currentCryptoPrice={spotPrice}
        cryptoSymbol={String(result.market.strikePrice)}
        totalEntryCost={curves.totalEntryCost}
        polyEntryCost={curves.polyEntryCost}
        bybitEntryCost={curves.bybitEntryCost}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        H={H.toFixed(2)} | Poly IV={(polyIv * 100).toFixed(1)}% | Bybit IV={(ticker.markIv * 100).toFixed(1)}%
      </Typography>
    </Box>
  );
}
