import { useState, useCallback, useEffect, useMemo } from 'react';
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
  Select,
  MenuItem,
  Button,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  Tooltip,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import type {
  OptionsCardData,
  BybitOptionChain as BybitChainType,
  BybitInstrument,
  BybitTicker,
  BybitSide,
} from '../../types';
import { fetchBybitInstruments, fetchBybitTickers, fetchBybitSpotPrice, groupByExpiry } from '../../api/bybit';

const OPT_COLOR = '#FF8C00'; // options orange

interface OptionsCardProps {
  id: string;
  data: OptionsCardData;
  onUpdate: (id: string, data: OptionsCardData) => void;
  onRemove: (id: string) => void;
  onMinimize: (id: string) => void;
  onChainLoaded?: (chain: BybitChainType) => void;
  spotPrice: number;
  refreshToken?: number;
}

interface StrikeRow {
  strike: number;
  call: { inst: BybitInstrument; ticker: BybitTicker } | null;
  put:  { inst: BybitInstrument; ticker: BybitTicker } | null;
}

export function OptionsCard({
  id,
  data,
  onUpdate,
  onRemove,
  onMinimize,
  onChainLoaded,
  spotPrice: externalSpot,
  refreshToken,
}: OptionsCardProps) {
  const [chains, setChains] = useState<BybitChainType[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spot, setSpot] = useState(externalSpot);
  // Per-strike qty: store raw strings so user can freely edit the field
  const [callQty, setCallQty] = useState<Map<number, string>>(new Map());
  const [putQty, setPutQty] = useState<Map<number, string>>(new Map());

  const update = useCallback((patch: Partial<OptionsCardData>) => {
    onUpdate(id, { ...data, ...patch });
  }, [id, data, onUpdate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [instruments, tickers, fetchedSpot] = await Promise.all([
          fetchBybitInstruments(),
          fetchBybitTickers(),
          fetchBybitSpotPrice(),
        ]);
        if (cancelled) return;
        const grouped = groupByExpiry(instruments, tickers);
        setChains(grouped);
        if (fetchedSpot > 0) setSpot(fetchedSpot);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Bybit data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeChain = useMemo(() =>
    selectedExpiry !== '' ? chains.find(c => c.expiryTimestamp === selectedExpiry) ?? null : null,
    [chains, selectedExpiry]
  );

  useEffect(() => {
    if (activeChain) {
      update({ chain: activeChain });
      onChainLoaded?.(activeChain);
    }
  }, [activeChain]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveSpot = spot || externalSpot || 0;

  const strikeRows = useMemo((): StrikeRow[] => {
    if (!activeChain) return [];
    const strikeSet = new Set<number>();
    for (const inst of activeChain.instruments) strikeSet.add(inst.strike);
    const strikes = Array.from(strikeSet).sort((a, b) => a - b);
    return strikes.map(strike => {
      const callInst = activeChain.instruments.find(i => i.optionsType === 'Call' && i.strike === strike) ?? null;
      const putInst  = activeChain.instruments.find(i => i.optionsType === 'Put'  && i.strike === strike) ?? null;
      return {
        strike,
        call: callInst ? { inst: callInst, ticker: activeChain.tickers.get(callInst.symbol)! } : null,
        put:  putInst  ? { inst: putInst,  ticker: activeChain.tickers.get(putInst.symbol)!  } : null,
      };
    }).filter(r => r.call?.ticker || r.put?.ticker);
  }, [activeChain]);

  const isSelected = (symbol: string, side: BybitSide) =>
    data.selectedOptions.some(o => o.symbol === symbol && o.side === side);

  const anyCallSelectedAtStrike = (strike: number) =>
    data.selectedOptions.some(o => o.strike === strike && o.optionsType === 'Call');

  const anyPutSelectedAtStrike = (strike: number) =>
    data.selectedOptions.some(o => o.strike === strike && o.optionsType === 'Put');

  const getCallQtyStr = (strike: number): string =>
    callQty.get(strike) ?? String(data.selectedOptions.find(o => o.strike === strike && o.optionsType === 'Call')?.quantity ?? 0.01);

  const getPutQtyStr = (strike: number): string =>
    putQty.get(strike) ?? String(data.selectedOptions.find(o => o.strike === strike && o.optionsType === 'Put')?.quantity ?? 0.01);

  const getCallQtyNum = (strike: number): number =>
    parseFloat(getCallQtyStr(strike)) || 0.01;

  const getPutQtyNum = (strike: number): number =>
    parseFloat(getPutQtyStr(strike)) || 0.01;

  const updateCallQtyValue = (strike: number, raw: string) => {
    setCallQty(prev => new Map(prev).set(strike, raw));
    const qty = parseFloat(raw);
    if (!isNaN(qty) && qty > 0) {
      update({
        selectedOptions: data.selectedOptions.map(o =>
          o.strike === strike && o.optionsType === 'Call' ? { ...o, quantity: qty } : o
        ),
      });
    }
  };

  const commitCallQty = (strike: number) => {
    const qty = parseFloat(getCallQtyStr(strike)) || 0.01;
    setCallQty(prev => new Map(prev).set(strike, String(qty)));
    update({
      selectedOptions: data.selectedOptions.map(o =>
        o.strike === strike && o.optionsType === 'Call' ? { ...o, quantity: qty } : o
      ),
    });
  };

  const updatePutQtyValue = (strike: number, raw: string) => {
    setPutQty(prev => new Map(prev).set(strike, raw));
    const qty = parseFloat(raw);
    if (!isNaN(qty) && qty > 0) {
      update({
        selectedOptions: data.selectedOptions.map(o =>
          o.strike === strike && o.optionsType === 'Put' ? { ...o, quantity: qty } : o
        ),
      });
    }
  };

  const commitPutQty = (strike: number) => {
    const qty = parseFloat(getPutQtyStr(strike)) || 0.01;
    setPutQty(prev => new Map(prev).set(strike, String(qty)));
    update({
      selectedOptions: data.selectedOptions.map(o =>
        o.strike === strike && o.optionsType === 'Put' ? { ...o, quantity: qty } : o
      ),
    });
  };

  const toggleOption = (inst: BybitInstrument, ticker: BybitTicker, side: BybitSide) => {
    if (isSelected(inst.symbol, side)) {
      update({ selectedOptions: data.selectedOptions.filter(o => !(o.symbol === inst.symbol && o.side === side)) });
    } else {
      // Always use bid1Price as entry price
      const entryPrice = ticker.bid1Price > 0 ? ticker.bid1Price : ticker.markPrice;
      const qty = inst.optionsType === 'Call' ? getCallQtyNum(inst.strike) : getPutQtyNum(inst.strike);
      const newOpt: OptionsCardData['selectedOptions'][0] = {
        symbol: inst.symbol,
        optionsType: inst.optionsType,
        strike: inst.strike,
        expiryTimestamp: inst.expiryTimestamp,
        side,
        quantity: qty,
        entryPrice,
        markIv: ticker.markIv,
      };
      update({ selectedOptions: [...data.selectedOptions, newOpt] });
    }
  };

  // Cell style helpers
  const numCell = { fontSize: 12, py: 0.4, px: 0.75 };
  const actionCell = { py: 0.4, px: 0.5 };

  const renderSide = (
    entry: { inst: BybitInstrument; ticker: BybitTicker } | null,
    isCall: boolean,
    effectiveSpot: number,
  ) => {
    if (!entry || !entry.ticker) {
      return (
        <>
          <TableCell sx={numCell}>—</TableCell>
          <TableCell sx={numCell}>—</TableCell>
          <TableCell sx={numCell}>—</TableCell>
          <TableCell sx={actionCell} />
          <TableCell sx={actionCell} />
        </>
      );
    }
    const { inst, ticker } = entry;
    const buySelected  = isSelected(inst.symbol, 'buy');
    const sellSelected = isSelected(inst.symbol, 'sell');
    const isNearSpot = effectiveSpot > 0 && Math.abs(inst.strike - effectiveSpot) / effectiveSpot < 0.03;
    const ivLabel  = ticker.markIv > 0 ? `${(ticker.markIv * 100).toFixed(1)}%` : '—';
    const bidLabel = ticker.bid1Price > 0 ? `$${ticker.bid1Price.toFixed(0)}` : '—';
    const askLabel = ticker.ask1Price > 0 ? `$${ticker.ask1Price.toFixed(0)}` : '—';

    if (isCall) {
      return (
        <>
          <TableCell sx={actionCell} align="center">
            <Button size="small" variant={buySelected ? 'contained' : 'outlined'} color="success"
              onClick={() => toggleOption(inst, ticker, 'buy')}
              sx={{ py: 0.1, px: 0.5, minWidth: 44, fontSize: 11 }}
              disabled={ticker.bid1Price <= 0}
            >Buy</Button>
          </TableCell>
          <TableCell sx={actionCell} align="center">
            <Button size="small" variant={sellSelected ? 'contained' : 'outlined'} color="error"
              onClick={() => toggleOption(inst, ticker, 'sell')}
              sx={{ py: 0.1, px: 0.5, minWidth: 44, fontSize: 11 }}
              disabled={ticker.bid1Price <= 0}
            >Sell</Button>
          </TableCell>
          <TableCell sx={{ ...numCell, fontWeight: isNearSpot ? 700 : 400 }} align="right">{ivLabel}</TableCell>
          <TableCell sx={numCell} align="right">{bidLabel}</TableCell>
          <TableCell sx={numCell} align="right">{askLabel}</TableCell>
        </>
      );
    } else {
      return (
        <>
          <TableCell sx={numCell} align="left">{bidLabel}</TableCell>
          <TableCell sx={numCell} align="left">{askLabel}</TableCell>
          <TableCell sx={{ ...numCell, fontWeight: isNearSpot ? 700 : 400 }} align="left">{ivLabel}</TableCell>
          <TableCell sx={actionCell} align="center">
            <Button size="small" variant={buySelected ? 'contained' : 'outlined'} color="success"
              onClick={() => toggleOption(inst, ticker, 'buy')}
              sx={{ py: 0.1, px: 0.5, minWidth: 44, fontSize: 11 }}
              disabled={ticker.bid1Price <= 0}
            >Buy</Button>
          </TableCell>
          <TableCell sx={actionCell} align="center">
            <Button size="small" variant={sellSelected ? 'contained' : 'outlined'} color="error"
              onClick={() => toggleOption(inst, ticker, 'sell')}
              sx={{ py: 0.1, px: 0.5, minWidth: 44, fontSize: 11 }}
              disabled={ticker.bid1Price <= 0}
            >Sell</Button>
          </TableCell>
        </>
      );
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Options / Bybit</Typography>
            <Tooltip title="Real-time data from Bybit V5 API. Mark price, bid/ask and implied volatility (markIv) are fetched live. markIv drives Black-Scholes P&L curve calculations. Greeks (delta, gamma, vega, theta) are fetched but not used in calculations." arrow>
              <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
            </Tooltip>
            {activeChain && <Chip label={activeChain.expiryLabel} size="small" />}
            {data.selectedOptions.length > 0 && (() => {
              const expiryTs = data.selectedOptions[0]?.expiryTimestamp;
              const expiryStr = expiryTs
                ? new Date(expiryTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                : null;
              const legWord = data.selectedOptions.length === 1 ? 'leg' : 'legs';
              return (
                <Chip
                  label={expiryStr ? `${data.selectedOptions.length} ${legWord} · exp ${expiryStr}` : `${data.selectedOptions.length} ${legWord}`}
                  size="small"
                  sx={{ bgcolor: OPT_COLOR, color: '#fff' }}
                />
              );
            })()}
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
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption">Loading Bybit chain...</Typography>
            </Box>
          )}
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

          <Box sx={{ mb: 2 }}>
            <Select size="small" value={selectedExpiry}
              onChange={e => {
                setSelectedExpiry(e.target.value as number | '');
                // Clear all selected positions when expiry changes — stale strikes are no longer valid
                setCallQty(new Map());
                setPutQty(new Map());
                update({ selectedOptions: [] });
              }}
              displayEmpty sx={{ minWidth: 240 }} disabled={loading}
            >
              <MenuItem value="">Select expiry...</MenuItem>
              {chains.map(c => (
                <MenuItem key={c.expiryTimestamp} value={c.expiryTimestamp}>
                  {c.expiryLabel} ({c.instruments.length / 2 | 0} strikes)
                </MenuItem>
              ))}
            </Select>
          </Box>

          {activeChain && strikeRows.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ tableLayout: 'fixed' }}>
                <colgroup>
                  {/* Call: Buy Sell IV Bid Ask Size | Strike | Size Put: Bid Ask IV Buy Sell */}
                  <col style={{ width: 46 }} />
                  <col style={{ width: 46 }} />
                  <col style={{ width: 52 }} />
                  <col style={{ width: 54 }} />
                  <col style={{ width: 54 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 54 }} />
                  <col style={{ width: 54 }} />
                  <col style={{ width: 52 }} />
                  <col style={{ width: 46 }} />
                  <col style={{ width: 46 }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 0.5, bgcolor: 'success.dark', color: '#fff', fontWeight: 700, fontSize: 12 }}>CALLS</TableCell>
                    <TableCell colSpan={1} align="center" sx={{ py: 0.5, fontWeight: 700, fontSize: 12 }}>Strike</TableCell>
                    <TableCell colSpan={6} align="center" sx={{ py: 0.5, bgcolor: 'error.dark', color: '#fff', fontWeight: 700, fontSize: 12 }}>PUTS</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Buy</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Sell</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="right">IV</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="right">Bid</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="right">Ask</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Size</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Strike</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Size</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="left">Bid</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="left">Ask</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="left">IV</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Buy</TableCell>
                    <TableCell sx={{ ...numCell, fontWeight: 600 }} align="center">Sell</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {strikeRows.map(row => {
                    const isNearSpot = effectiveSpot > 0 && Math.abs(row.strike - effectiveSpot) / effectiveSpot < 0.03;
                    const hasCallSelection = anyCallSelectedAtStrike(row.strike);
                    const hasPutSelection = anyPutSelectedAtStrike(row.strike);
                    const sizeFieldSx = { width: 66 };
                    const sizeInputProps = { step: 'any', style: { fontSize: 12, padding: '3px 4px' } };
                    return (
                      <TableRow key={row.strike} sx={{ bgcolor: isNearSpot ? 'action.selected' : undefined }}>
                        {renderSide(row.call, true, effectiveSpot)}
                        <TableCell align="center" sx={{ py: 0.25, px: 0.5 }}>
                          {hasCallSelection ? (
                            <TextField
                              size="small"
                              type="number"
                              value={getCallQtyStr(row.strike)}
                              onChange={e => updateCallQtyValue(row.strike, e.target.value)}
                              onBlur={() => commitCallQty(row.strike)}
                              sx={sizeFieldSx}
                              inputProps={sizeInputProps}
                            />
                          ) : (
                            <Typography variant="caption" color="text.disabled">—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center" sx={{
                          ...numCell,
                          fontWeight: isNearSpot ? 800 : 600,
                          color: isNearSpot ? 'warning.main' : 'text.primary',
                        }}>
                          {row.strike.toLocaleString()}
                        </TableCell>
                        <TableCell align="center" sx={{ py: 0.25, px: 0.5 }}>
                          {hasPutSelection ? (
                            <TextField
                              size="small"
                              type="number"
                              value={getPutQtyStr(row.strike)}
                              onChange={e => updatePutQtyValue(row.strike, e.target.value)}
                              onBlur={() => commitPutQty(row.strike)}
                              sx={sizeFieldSx}
                              inputProps={sizeInputProps}
                            />
                          ) : (
                            <Typography variant="caption" color="text.disabled">—</Typography>
                          )}
                        </TableCell>
                        {renderSide(row.put, false, effectiveSpot)}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* Compact selected legs summary (chip + delete only, no extra inputs) */}
          {data.selectedOptions.length > 0 && (
            <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {data.selectedOptions.map(opt => (
                <Chip
                  key={`${opt.symbol}-${opt.side}`}
                  label={`${opt.side === 'buy' ? '●' : '✕'} ${opt.side === 'buy' ? 'Buy' : 'Sell'} ${opt.optionsType} $${opt.strike.toLocaleString()} ×${opt.quantity} @ $${opt.entryPrice.toFixed(0)}`}
                  size="small"
                  sx={{ bgcolor: OPT_COLOR, color: '#fff', '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' } } }}
                  onDelete={() => update({ selectedOptions: data.selectedOptions.filter(o => !(o.symbol === opt.symbol && o.side === opt.side)) })}
                />
              ))}
            </Box>
          )}
        </CardContent>
      )}
    </Card>
  );
}
