import {
  Card,
  CardHeader,
  CardContent,
  IconButton,
  Typography,
  Box,
  TextField,
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
import type { BacktestPosition, CryptoOption } from '../../types';

interface BacktestFuturesCardProps {
  id: string;
  position: BacktestPosition;
  onUpdate: (id: string, patch: Partial<BacktestPosition>) => void;
  onRemove: (id: string) => void;
  onMinimize: (id: string) => void;
  minimized: boolean;
}

export function BacktestFuturesCard({
  id,
  position,
  onUpdate,
  onRemove,
  onMinimize,
  minimized,
}: BacktestFuturesCardProps) {
  const crypto = (position.futuresSymbol ?? 'BTC') as CryptoOption;
  const size = position.futuresSize ?? 0.001;
  const direction: 'long' | 'short' = size >= 0 ? 'long' : 'short';

  const updateLabel = (sym: string, sz: number) => {
    const dir = sz >= 0 ? 'Long' : 'Short';
    onUpdate(id, { futuresSymbol: sym, futuresSize: sz, label: `${dir} ${sym} futures` });
  };

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Futures</Typography>
            <Chip label={crypto} size="small" color="secondary" />
            <Chip
              label={direction.toUpperCase()}
              size="small"
              color={direction === 'long' ? 'success' : 'error'}
            />
          </Box>
        }
        action={
          <Box>
            <IconButton size="small" onClick={() => onMinimize(id)}>
              {minimized ? <ExpandMore /> : <ExpandLess />}
            </IconButton>
            <IconButton size="small" onClick={() => onRemove(id)} color="error">
              <Delete />
            </IconButton>
          </Box>
        }
        sx={{ pb: minimized ? 0 : undefined }}
      />
      {!minimized && (
        <CardContent sx={{ pt: 1 }}>
          {/* Asset */}
          <RadioGroup
            value={crypto}
            onChange={(_, v) => updateLabel(v, size)}
            row
            sx={{ mb: 2 }}
          >
            {(['BTC', 'ETH', 'SOL', 'XRP'] as CryptoOption[]).map(c => (
              <FormControlLabel key={c} value={c} control={<Radio size="small" />} label={c} />
            ))}
          </RadioGroup>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Direction */}
            <ToggleButtonGroup
              value={direction}
              exclusive
              onChange={(_, v) => {
                if (!v) return;
                const absSize = Math.abs(size) || 0.001;
                const newSize = v === 'long' ? absSize : -absSize;
                updateLabel(crypto, newSize);
              }}
              size="small"
            >
              <ToggleButton value="long" sx={{ px: 2, '&.Mui-selected': { color: 'success.main', borderColor: 'success.main' } }}>Long</ToggleButton>
              <ToggleButton value="short" sx={{ px: 2, '&.Mui-selected': { color: 'error.main', borderColor: 'error.main' } }}>Short</ToggleButton>
            </ToggleButtonGroup>

            {/* Size */}
            <TextField
              label="Size"
              size="small"
              type="number"
              value={Math.abs(size)}
              onChange={e => {
                const absVal = Math.abs(parseFloat(e.target.value) || 0.001);
                const newSize = direction === 'long' ? absVal : -absVal;
                updateLabel(crypto, newSize);
              }}
              sx={{ width: 120 }}
              inputProps={{ step: 'any', min: 0 }}
            />

            {/* Entry Price */}
            <TextField
              label="Entry Price"
              size="small"
              type="number"
              value={position.entryPrice || ''}
              onChange={e => onUpdate(id, { entryPrice: parseFloat(e.target.value) || 0 })}
              sx={{ width: 160 }}
              inputProps={{ min: 0, step: 100 }}
              placeholder="Auto"
              helperText="Leave empty to use first available price"
            />
          </Box>
        </CardContent>
      )}
    </Card>
  );
}
