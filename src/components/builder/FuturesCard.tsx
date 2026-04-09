import {
  Card,
  CardHeader,
  CardContent,
  IconButton,
  TextField,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import type { FuturesCardData } from '../../types';

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
  const usdtSize = Math.abs(data.size) * (data.entryPrice || 0);
  const requiredMargin = leverage > 0 ? usdtSize / leverage : 0;

  const livePnl = spotPrice > 0 && data.entryPrice > 0
    ? (spotPrice - data.entryPrice) * data.size
    : null;

  const update = (patch: Partial<FuturesCardData>) => {
    onUpdate(id, { ...data, ...patch });
  };

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Futures Position</Typography>
            {data.symbol && <Chip label={data.symbol} size="small" color="secondary" />}
            {data.size !== 0 && (
              <Chip label={data.size > 0 ? 'LONG' : 'SHORT'} size="small" color={data.size > 0 ? 'success' : 'error'} />
            )}
            {livePnl !== null && (
              <Chip
                label={`P&L: ${livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}`}
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
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              label="Symbol"
              size="small"
              value={data.symbol}
              onChange={e => update({ symbol: e.target.value.toUpperCase() })}
              sx={{ width: 140 }}
              placeholder="BTCUSDT"
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
              label="Size (+long / −short)"
              size="small"
              type="number"
              value={data.size === 0 ? '' : data.size}
              onChange={e => {
                const raw = e.target.value;
                update({ size: raw === '' || raw === '-' ? 0 : (parseFloat(raw) || 0) });
              }}
              sx={{ width: 160 }}
              inputProps={{ step: 'any' }}
              helperText="Positive = long, negative = short"
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
                USDT size: <strong>${usdtSize.toFixed(2)}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Required margin: <strong>${requiredMargin.toFixed(2)}</strong> (×{leverage} lev)
              </Typography>
              {spotPrice > 0 && (
                <Typography variant="body2">
                  Live P&L:{' '}
                  <span style={{ color: livePnl! >= 0 ? '#22C55E' : '#EF4444', fontWeight: 600 }}>
                    {livePnl! >= 0 ? '+' : ''}{livePnl!.toFixed(2)} USD
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
