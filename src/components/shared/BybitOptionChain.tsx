import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import type { BybitBaseCoin, BybitOptionChain as BybitChainType } from '../../types';
import { fetchBybitInstruments, fetchBybitTickers, fetchBybitSpotPrice, groupByExpiry } from '../../api/bybit';

interface BybitOptionChainProps {
  onChainSelected: (chain: BybitChainType | null) => void;
  onSpotPriceLoaded: (price: number) => void;
  requestedExpiry?: number;
  refreshToken?: number;
  baseCoin: BybitBaseCoin;
  onBaseCoinChange: (baseCoin: BybitBaseCoin) => void;
}

export function BybitOptionChain({ onChainSelected, onSpotPriceLoaded, requestedExpiry, refreshToken, baseCoin, onBaseCoinChange }: BybitOptionChainProps) {
  const [chains, setChains] = useState<BybitChainType[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch instruments + tickers on mount and when refreshToken changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setSelectedExpiry('');
        onChainSelected(null);
        const [instruments, tickers, spot] = await Promise.all([
          fetchBybitInstruments(baseCoin),
          fetchBybitTickers(baseCoin),
          fetchBybitSpotPrice(baseCoin),
        ]);
        if (cancelled) return;
        const grouped = groupByExpiry(instruments, tickers, baseCoin);
        setChains(grouped);
        onSpotPriceLoaded(spot);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch Bybit data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onSpotPriceLoaded, onChainSelected, refreshToken, baseCoin]);

  const activeChain = useMemo(() => {
    if (selectedExpiry === '') return null;
    return chains.find(c => c.expiryTimestamp === selectedExpiry) ?? null;
  }, [chains, selectedExpiry]);

  // Selecting an expiry only updates local state; the activeChain effect below is
  // the single source that notifies the parent (avoids a double onChainSelected).
  const handleExpiryChange = useCallback((value: number | '') => {
    setSelectedExpiry(value);
  }, []);

  // Sole notifier: fires whenever the resolved chain changes (selection, data load,
  // or requested-expiry auto-select all flow through here exactly once).
  useEffect(() => {
    onChainSelected(activeChain);
  }, [activeChain, onChainSelected]);

  // Auto-select expiry requested from a loaded file
  useEffect(() => {
    if (!requestedExpiry || chains.length === 0) return;
    const exact = chains.find(c => c.expiryTimestamp === requestedExpiry);
    const target = exact ?? chains
      .filter(c => c.expiryTimestamp >= requestedExpiry)
      .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp)[0];
    if (target) {
      setSelectedExpiry(target.expiryTimestamp);
    }
  }, [requestedExpiry, chains]); // eslint-disable-line react-hooks/exhaustive-deps

  const selector = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant="body2" color="text.secondary">Underlying</Typography>
      <ToggleButtonGroup
        value={baseCoin}
        exclusive
        size="small"
        onChange={(_, v) => v && onBaseCoinChange(v as BybitBaseCoin)}
      >
        <ToggleButton value="BTC">BTC</ToggleButton>
        <ToggleButton value="XAUT">XAUT</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selector}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Loading option chain...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {selector}

      {error && <Alert severity="error">{error}</Alert>}

      {/* Expiry selector */}
      <Select
        size="small"
        value={selectedExpiry}
        onChange={e => handleExpiryChange(e.target.value as number | '')}
        displayEmpty
        sx={{ maxWidth: 300 }}
      >
        <MenuItem value="">Select expiration...</MenuItem>
        {chains.map(chain => (
          <MenuItem key={chain.expiryTimestamp} value={chain.expiryTimestamp}>
            {chain.expiryLabel} ({chain.instruments.length} contracts)
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
