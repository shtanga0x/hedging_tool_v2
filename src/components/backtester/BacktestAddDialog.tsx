import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Box,
} from '@mui/material';
import { useState } from 'react';

type AddKind = 'polymarket' | 'deribit' | 'futures';

interface BacktestAddDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (kind: AddKind) => void;
}

const OPTIONS: { value: AddKind; label: string; description: string }[] = [
  {
    value: 'polymarket',
    label: 'Polymarket',
    description: 'Binary options from Polymarket events (YES/NO positions)',
  },
  {
    value: 'deribit',
    label: 'Option',
    description: 'Historical mark-price candles from Deribit or Bybit (BTC/ETH)',
  },
  {
    value: 'futures',
    label: 'Futures',
    description: 'Spot/futures price history from Binance (BTC/ETH/SOL/XRP)',
  },
];

export function BacktestAddDialog({ open, onClose, onAdd }: BacktestAddDialogProps) {
  const [selected, setSelected] = useState<AddKind>('polymarket');

  const handleAdd = () => {
    onAdd(selected);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add Backtest Position</DialogTitle>
      <DialogContent>
        <RadioGroup value={selected} onChange={(_, v) => setSelected(v as AddKind)}>
          {OPTIONS.map(opt => (
            <FormControlLabel
              key={opt.value}
              value={opt.value}
              control={<Radio />}
              label={
                <Box sx={{ py: 0.5 }}>
                  <Typography variant="body1" fontWeight={600}>{opt.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{opt.description}</Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleAdd}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}
