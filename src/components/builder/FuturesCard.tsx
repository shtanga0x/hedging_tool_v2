import {
  Card,
  CardHeader,
  CardContent,
  IconButton,
  TextField,
  Typography,
  Box,
  Chip,
  RadioGroup,
  FormControlLabel,
  Radio,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import type { FuturesCardData } from '../../types';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;

function symbolToAsset(symbol: string): string {
  return ASSETS.find(a => symbol.startsWith(a)) ?? 'BTC';
}

interface FuturesCardProps {
  id: string;
  data: FuturesCardData;
  spotPrice: number;
  onUpdate: (id: string, data: FuturesCardData) => void;
  onRemove: (id: string) => void;
  onMinimize: (id: string) => void;
}

export function FuturesCard({ id, data, spotPrice, onUpdate, onRemove, onMinimize }: FuturesCardProps) {
  const leverage = data.leverage ?? 5;
  const asset = symbolToAsset(data.symbol || 'BTC');
  const absSize = Math.abs(data.size);
  const direction: 'long' | 'short' = data.size >= 0 ? 'long' : 'short';

  const notional = absSize * (data.entryPrice || 0);
  const requiredMargin = leverage > 0 ? notional / leverage : 0;

  const livePnl = spotPrice > 0 && data.entryPrice > 0
    ? (spotPrice - data.entryPrice) * data.size
    : null;
  const liveRoi = livePnl !== null && requiredMargin > 0
    ? (livePnl / requiredMargin) * 100
    : null;

  const update = (patch: Partial<FuturesCardData>) => {
    onUpdate(id, { ...data, ...patch });
  };

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Futures</Typography>
            <Chip label={asset} size="small" color="secondary" />
            <Chip label={direction.toUpperCase()} size="small" color={direction === 'long' ? 'success' : 'error'} />
            {livePnl !== null && (
              <Chip
                label={`${livePnl >= 0 ? '+' : ''}$${livePnl.toFixed(2)}${liveRoi !== null ? ` (${liveRoi >= 0 ? '+' : ''}${liveRoi.toFixed(1)}%)` : ''}`}
                size="small"
                color={livePnl >= 0 ? 'success' : 'error'}
              />
            )}
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
          <RadioGroup
            value={asset}
            onChange={(_, v) => update({ symbol: `${v}USDT` })}
            row
            sx={{ mb: 2 }}
          >
            {ASSETS.map(a => (
              <FormControlLabel key={a} value={a} control={<Radio size="small" />} label={a} />
            ))}
          </RadioGroup>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              value={direction}
              exclusive
              onChange={(_, v) => {
                if (!v) return;
                const newSize = v === 'long' ? absSize : -absSize;
                update({ size: newSize });
              }}
              size="small"
            >
              <ToggleButton value="long" sx={{ px: 2, '&.Mui-selected': { color: 'success.main', borderColor: 'success.main' } }}>Long</ToggleButton>
              <ToggleButton value="short" sx={{ px: 2, '&.Mui-selected': { color: 'error.main', borderColor: 'error.main' } }}>Short</ToggleButton>
            </ToggleButtonGroup>

            <TextField
              label="Size"
              size="small"
              type="number"
              value={absSize || ''}
              onChange={e => {
                const v = Math.abs(parseFloat(e.target.value) || 0);
                update({ size: direction === 'long' ? v : -v });
              }}
              sx={{ width: 120 }}
              inputProps={{ step: 'any', min: 0 }}
            />

            <TextField
              label="Entry Price"
              size="small"
              type="number"
              value={data.entryPrice || ''}
              onChange={e => update({ entryPrice: parseFloat(e.target.value) || 0 })}
              sx={{ width: 140 }}
              inputProps={{ min: 0, step: 100 }}
            />

            <TextField
              label="Leverage"
              size="small"
              type="number"
              value={leverage}
              onChange={e => update({ leverage: Math.max(1, parseFloat(e.target.value) || 1) })}
              sx={{ width: 100 }}
              inputProps={{ min: 1, step: 1 }}
            />
          </Box>

          {data.entryPrice > 0 && data.size !== 0 && (
            <Box sx={{ mt: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Notional: <strong>${notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Margin: <strong>${requiredMargin.toFixed(2)}</strong> (×{leverage})
              </Typography>
              {spotPrice > 0 && livePnl !== null && (
                <Typography variant="body2">
                  Live P&L:{' '}
                  <span style={{ color: livePnl >= 0 ? '#22C55E' : '#EF4444', fontWeight: 600 }}>
                    {livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}
                    {liveRoi !== null && ` (${liveRoi >= 0 ? '+' : ''}${liveRoi.toFixed(1)}% on margin)`}
                  </span>
                </Typography>
              )}
            </Box>
          )}
        </CardContent>
      )}
    </Card>
  );
}
