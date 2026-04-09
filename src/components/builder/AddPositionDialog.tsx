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
import type { PositionKind } from '../../types';

interface AddPositionDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (kind: PositionKind) => void;
}

const OPTIONS: { value: PositionKind; label: string; description: string }[] = [
  {
    value: 'polymarket',
    label: 'Polymarket',
    description: 'Binary options from Polymarket events (YES/NO positions)',
  },
  {
    value: 'options',
    label: 'Options / Bybit',
    description: 'Vanilla options from Bybit option chain (Calls & Puts)',
  },
  {
    value: 'futures',
    label: 'Futures',
    description: 'Linear perpetual or futures contract (long/short)',
  },
];

export function AddPositionDialog({ open, onClose, onAdd }: AddPositionDialogProps) {
  const [selected, setSelected] = useState<PositionKind>('polymarket');

  const handleAdd = () => {
    onAdd(selected);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add Position</DialogTitle>
      <DialogContent>
        <RadioGroup value={selected} onChange={(_, v) => setSelected(v as PositionKind)}>
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
