import { useMemo, useState, useEffect, useRef } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
} from '@mui/material';
import Delete from '@mui/icons-material/Delete';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import type { BacktestPosition } from '../../types';
import { validateDeribitInstrument } from '../../api/deribit';

const OPT_COLOR = '#FF8C00';
const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** Returns { month: 'YYYY-MM', day: 'D' } for the next Friday from today. */
function getNextFriday(): { month: string; day: string } {
  const now = new Date();
  const daysUntil = (5 - now.getDay() + 7) % 7 || 7; // always at least 1 day ahead
  const fri = new Date(now);
  fri.setDate(now.getDate() + daysUntil);
  return {
    month: `${fri.getFullYear()}-${String(fri.getMonth() + 1).padStart(2, '0')}`,
    day: String(fri.getDate()),
  };
}

function getMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    opts.push({ value: `${year}-${String(month).padStart(2, '0')}`, label: monthLabel });
  }
  return opts;
}

interface BacktestOptionCardProps {
  id: string;
  position: BacktestPosition;
  onUpdate: (id: string, patch: Partial<BacktestPosition>) => void;
  onRemove: (id: string) => void;
  onMinimize: (id: string) => void;
  minimized: boolean;
}

export function BacktestOptionCard({
  id,
  position,
  onUpdate,
  onRemove,
  onMinimize,
  minimized,
}: BacktestOptionCardProps) {
  const monthOptions = useMemo(getMonthOptions, []);

  // Parse an instrument name into form field values
  const parseInstName = (name: string) => {
    const n = name.replace(/-USDT$/, '');
    const m = n.match(/^(BTC|ETH)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/);
    if (!m) return null;
    const monthIdx = MONTH_NAMES.indexOf(m[3]);
    const year = 2000 + parseInt(m[4]);
    return {
      asset: m[1] as 'BTC' | 'ETH',
      day: m[2],
      month: `${year}-${String(monthIdx + 1).padStart(2, '0')}`,
      strike: m[5],
      optType: m[6] as 'C' | 'P',
    };
  };

  // Local state for all form fields — decoupled from position.instrumentName
  // so partial edits (e.g. clearing strike while typing day) don't reset the fields.
  const initParsed = parseInstName(position.instrumentName ?? '');
  const [localAsset, setLocalAsset] = useState<'BTC' | 'ETH'>(initParsed?.asset ?? 'BTC');
  const [localOptType, setLocalOptType] = useState<'C' | 'P'>(initParsed?.optType ?? 'C');
  const defaultFriday = useMemo(getNextFriday, []);
  const [localMonth, setLocalMonth] = useState<string>(initParsed?.month ?? defaultFriday.month);
  const [localDay, setLocalDay] = useState<string>(initParsed?.day ?? defaultFriday.day);
  const [localStrike, setLocalStrike] = useState<string>(initParsed?.strike ?? '');

  // Sync local state when the parent changes instrumentName externally
  const prevInstName = useRef(position.instrumentName ?? '');
  useEffect(() => {
    const cur = position.instrumentName ?? '';
    if (cur !== prevInstName.current) {
      prevInstName.current = cur;
      const p = parseInstName(cur);
      if (p) {
        setLocalAsset(p.asset);
        setLocalOptType(p.optType);
        setLocalMonth(p.month);
        setLocalDay(p.day);
        setLocalStrike(p.strike);
      }
    }
  }, [position.instrumentName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived display values
  const manualName = position.instrumentName?.replace(/-USDT$/, '') ?? '';

  const buildName = (a: string, m: string, d: string, s: string, t: string) => {
    if (!m || !d || !s) return '';
    const [year, monthNum] = m.split('-');
    const monthName = MONTH_NAMES[parseInt(monthNum) - 1];
    if (!monthName) return '';
    return `${a}-${parseInt(d)}${monthName}${year.slice(2)}-${parseInt(s)}-${t}`;
  };

  const dropdownName = buildName(localAsset, localMonth, localDay, localStrike, localOptType);
  const baseName = manualName || dropdownName;
  const isValid = validateDeribitInstrument(baseName);

  const updateInstrument = (newBaseName: string) => {
    const patch: Partial<BacktestPosition> = { instrumentName: newBaseName, label: newBaseName || 'Option' };
    const p = parseInstName(newBaseName);
    if (p) {
      const [yearStr, monthNumStr] = p.month.split('-');
      // Deribit options expire at 08:00 UTC on expiry day
      const expiryDate = new Date(Date.UTC(parseInt(yearStr), parseInt(monthNumStr) - 1, parseInt(p.day), 8, 0, 0));
      patch.optStrike = parseInt(p.strike);
      patch.optExpiryMs = expiryDate.getTime();
      patch.optType = p.optType === 'C' ? 'Call' : 'Put';
    }
    onUpdate(id, patch);
  };

  // Only propagate to parent when all fields produce a valid name; otherwise
  // just update local state so the field doesn't snap back to an old value.
  const updateFromDropdowns = (a: string, m: string, d: string, s: string, t: string) => {
    const name = buildName(a, m, d, s, t);
    if (name) updateInstrument(name);
  };

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={600}>Option</Typography>
            {baseName && <Chip label={baseName} size="small" sx={{ bgcolor: OPT_COLOR, color: '#fff' }} />}
            {isValid && <Chip label="✓ valid" size="small" color="success" variant="outlined" />}
            <Tooltip title="Historical mark-price candles (60 min). Instrument format: BTC-28MAR25-100000-C. Bybit BS uses Black-Scholes reconstruction from entry IV." arrow>
              <InfoOutlined sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help' }} />
            </Tooltip>
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
          {/* Row 1: Asset + Call/Put */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <RadioGroup value={localAsset} onChange={(_, v) => { setLocalAsset(v as 'BTC' | 'ETH'); updateFromDropdowns(v, localMonth, localDay, localStrike, localOptType); }} row>
              <FormControlLabel value="BTC" control={<Radio size="small" />} label="BTC" />
              <FormControlLabel value="ETH" control={<Radio size="small" />} label="ETH" />
            </RadioGroup>
            <ToggleButtonGroup
              value={localOptType}
              exclusive
              onChange={(_, v) => { if (v) { setLocalOptType(v as 'C' | 'P'); updateFromDropdowns(localAsset, localMonth, localDay, localStrike, v); } }}
              size="small"
            >
              <ToggleButton value="C" sx={{ px: 2 }}>Call</ToggleButton>
              <ToggleButton value="P" sx={{ px: 2 }}>Put</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Row 2: Month + Day + Strike */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start', mb: 2 }}>
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel>Month</InputLabel>
              <Select
                value={localMonth}
                label="Month"
                onChange={e => { setLocalMonth(e.target.value); updateFromDropdowns(localAsset, e.target.value, localDay, localStrike, localOptType); }}
              >
                {monthOptions.map(o => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Day"
              size="small"
              type="number"
              value={localDay}
              onChange={e => { setLocalDay(e.target.value); updateFromDropdowns(localAsset, localMonth, e.target.value, localStrike, localOptType); }}
              sx={{ width: 80 }}
              inputProps={{ min: 1, max: 31, step: 1 }}
            />
            <TextField
              label="Strike"
              size="small"
              type="number"
              value={localStrike}
              onChange={e => { setLocalStrike(e.target.value); updateFromDropdowns(localAsset, localMonth, localDay, e.target.value, localOptType); }}
              sx={{ width: 130 }}
              inputProps={{ min: 0, step: 1000 }}
              placeholder="100000"
            />
          </Box>

          {/* Instrument name (manual override) */}
          <TextField
            label="Instrument Name"
            size="small"
            fullWidth
            value={baseName}
            onChange={e => updateInstrument(e.target.value.toUpperCase().replace(/-USDT$/, ''))}
            placeholder="BTC-28MAR25-100000-C"
            error={baseName.length > 0 && !isValid}
            helperText={
              baseName.length > 0 && !isValid
                ? 'Invalid format — expected BTC-28MAR25-100000-C'
                : isValid
                  ? `✓ Instrument: ${baseName}`
                  : 'Fill dropdowns above or type directly'
            }
            sx={{ mb: 2 }}
          />

          {/* Quantity */}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Quantity"
              size="small"
              type="number"
              value={position.quantity ?? 0.01}
              onChange={e => onUpdate(id, { quantity: parseFloat(e.target.value) || 0.01 })}
              sx={{ width: 120 }}
              inputProps={{ step: 'any' }}
              helperText="+buy / -sell"
            />
          </Box>
        </CardContent>
      )}
    </Card>
  );
}
