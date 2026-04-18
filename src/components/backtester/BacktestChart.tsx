import { useState, useCallback, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { Box, Chip, ToggleButton, ToggleButtonGroup, Button, Menu, MenuItem, IconButton, Tooltip, Slider, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ZoomIn from '@mui/icons-material/ZoomIn';
import ZoomOut from '@mui/icons-material/ZoomOut';
import ZoomOutMap from '@mui/icons-material/ZoomOutMap';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import RestartAlt from '@mui/icons-material/RestartAlt';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Customized,
  usePlotArea,
} from 'recharts';
import type { BacktestResult } from './BacktesterTab';
import type { OHLCCandle } from '../../api/binance';
import type { BacktestPosition } from '../../types';

// ─── Color palette ────────────────────────────────────────────────────────────
const CRYPTO_COLORS: Record<string, string> = { BTC: '#F7931A', ETH: '#627EEA' };
const POLY_COLOR    = '#4A90D9'; // polymarket blue
const OPT_COLOR     = '#FF8C00'; // orange (fallback)

type DataSource = 'deribit' | 'bybit' | 'bybit-bs';
const SOURCE_LABELS: Record<DataSource, string> = { deribit: 'Deribit', bybit: 'Bybit', 'bybit-bs': 'BS' };
const SOURCE_COLORS: Record<DataSource, string> = { deribit: '#4A90D9', bybit: '#F97316', 'bybit-bs': '#A78BFA' };
const FUTURES_COLOR_DARK  = '#B0BEC5'; // bright grey for dark mode
const FUTURES_COLOR_LIGHT = '#6B7280'; // dark grey for light mode

// Full crypto names for axis labels
const CRYPTO_FULL_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'Ripple',
};

// ─── Candle interval options ──────────────────────────────────────────────────
const CANDLE_INTERVALS = ['1h', '4h', '1d'] as const;

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_POINTS        = 800;   // default cap — keeps rendering fast
const MAX_SMOOTH_POINTS = 300;   // additional reduction in smooth mode
const MARKERS_PER_LINE  = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isBuy(pos: BacktestPosition): boolean {
  if (pos.kind === 'polymarket') return pos.polySide !== 'NO';
  if (pos.kind === 'deribit')    return (pos.quantity ?? 1) > 0;
  if (pos.kind === 'futures')    return (pos.futuresSize ?? 1) > 0;
  return true;
}

function getPositionColor(result: BacktestResult, isDark: boolean): string {
  const pos = result.position;
  if (pos.kind === 'polymarket') return POLY_COLOR;
  if (pos.kind === 'futures') return isDark ? FUTURES_COLOR_DARK : FUTURES_COLOR_LIGHT;
  if (result.source && SOURCE_COLORS[result.source as DataSource]) return SOURCE_COLORS[result.source as DataSource];
  return OPT_COLOR;
}

/** Returns strokeDasharray for a result. */
function getLineDash(result: BacktestResult): string | undefined {
  if (result.source === 'deribit')  return '3 5';   // dotted  — reference
  if (result.source === 'bybit-bs') return '10 5';  // dashed  — synthetic BS
  if (result.source === 'bybit')    return undefined; // solid  — real library data
  return '8 4'; // polymarket / futures
}

/** Uniform downsampling — preserves first and last points. */
function downsample(ts: number[], maxPts: number): number[] {
  if (ts.length <= maxPts) return ts;
  const result: number[] = [];
  const step = (ts.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts; i++) {
    result.push(ts[Math.round(i * step)]);
  }
  return result;
}

/** Binary-search — last pnl value with timestamp <= target. */
function findLastBefore(series: { timestamp: number; pnl: number }[], target: number): number | null {
  let lo = 0, hi = series.length - 1, result: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].timestamp <= target) { result = series[mid].pnl; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}

/** Binary-search — nearest candle close price within 10 min. */
function findNearestClose(candles: OHLCCandle[], target: number): number | null {
  const MAX_DELTA = 600;
  if (!candles.length) return null;
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t < target) lo = mid + 1; else hi = mid;
  }
  let best: number | null = null, bestDelta = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx >= 0 && idx < candles.length) {
      const d = Math.abs(candles[idx].t - target);
      if (d < bestDelta && d <= MAX_DELTA) { bestDelta = d; best = candles[idx].c; }
    }
  }
  return best;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BacktestChartProps {
  results: BacktestResult[];
  startTimestamp: number;
  endTimestamp: number;
  cryptoOverlay: 'BTC' | 'ETH' | null;
  onCryptoOverlayChange: (v: 'BTC' | 'ETH' | null) => void;
  cryptoCandles: OHLCCandle[];
  candleInterval: string;
  onCandleIntervalChange: (interval: string) => void;
}

interface ChartDataRow {
  timestamp: number;
  [key: string]: number;
}

interface LegendItem {
  key: string;
  label: string;
  color: string;
  dash?: string;
  width: number;
  markerShape?: 'circle' | 'x';
}

// ─── Custom dot renderers ─────────────────────────────────────────────────────
function makeDotRenderer(buy: boolean, color: string, markerSet: Set<number>) {
  return (props: Record<string, unknown>) => {
    const cx = props.cx as number;
    const cy = props.cy as number;
    const index = props.index as number;
    if (!markerSet.has(index) || cx == null || cy == null || isNaN(cx) || isNaN(cy)) {
      return <g />;
    }
    if (buy) {
      return <circle cx={cx} cy={cy} r={3} fill={color} stroke={color} strokeWidth={1} />;
    }
    const s = 3;
    return (
      <g>
        <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </g>
    );
  };
}

// ─── CandlestickLayer ─────────────────────────────────────────────────────────
interface CandlestickLayerProps {
  candles: OHLCCandle[];
  xDomain: [number, number];
  yDomain: [number, number];
  [key: string]: unknown;
}

function CandlestickLayer({ candles, xDomain, yDomain }: CandlestickLayerProps) {
  const plotArea = usePlotArea();
  if (!plotArea || !candles.length || !yDomain) return null;

  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;
  if (xMax === xMin || yMax === yMin) return null;

  const { x: px, y: py, width: pw, height: ph } = plotArea;

  const toXPx = (v: number) => px + pw * (v - xMin) / (xMax - xMin);
  const toYPx = (v: number) => py + ph * (1 - (v - yMin) / (yMax - yMin));

  const sorted = [...candles].sort((a, b) => a.t - b.t);

  let halfBody = 3;
  if (sorted.length > 1) {
    const spacings: number[] = [];
    for (let i = 1; i < Math.min(sorted.length, 20); i++) {
      spacings.push(Math.abs(toXPx(sorted[i].t) - toXPx(sorted[i - 1].t)));
    }
    const avg = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    halfBody = Math.max(1.5, Math.min(14, avg * 0.38));
  }

  return (
    <g>
      <defs>
        <clipPath id="candle-plot-clip">
          <rect x={px} y={py} width={pw} height={ph} />
        </clipPath>
      </defs>
      <g clipPath="url(#candle-plot-clip)">
        {sorted.map(c => {
          const cx    = toXPx(c.t);
          const bullish = c.c >= c.o;
          const color   = bullish ? '#22C55E' : '#EF4444';
          const yHpx = toYPx(c.h);
          const yLpx = toYPx(c.l);
          const yOpx = toYPx(c.o);
          const yCpx = toYPx(c.c);
          const bodyTop    = Math.min(yOpx, yCpx);
          const bodyBottom = Math.max(yOpx, yCpx);
          return (
            <g key={c.t}>
              <line x1={cx} y1={yHpx} x2={cx} y2={yLpx} stroke={color} strokeWidth={1} />
              <rect
                x={cx - halfBody} y={bodyTop}
                width={halfBody * 2} height={Math.max(1, bodyBottom - bodyTop)}
                fill={color} stroke={color} strokeWidth={0.5}
              />
            </g>
          );
        })}
      </g>
    </g>
  );
}

// ─── Main chart component ─────────────────────────────────────────────────────
export function BacktestChart({
  results,
  startTimestamp,
  endTimestamp,
  cryptoOverlay,
  onCryptoOverlayChange,
  cryptoCandles,
  candleInterval,
  onCandleIntervalChange,
}: BacktestChartProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [grouped, setGrouped]             = useState(false);
  const [hiddenLines, setHiddenLines]     = useState<Set<string>>(new Set());
  // Deribit is a reference curve (mark-price); BS reconstruction is shown by default
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set(['deribit']));
  const [overlayAnchor, setOverlayAnchor] = useState<null | HTMLElement>(null);
  const [rightAxisZoom, setRightAxisZoom]     = useState(1.0);
  const [rightAxisOffset, setRightAxisOffset] = useState(0);
  const [smoothing, setSmoothing]         = useState(false);
  const [endAlign, setEndAlign]           = useState(true);
  const [zeroNorm, setZeroNorm]           = useState(false);
  // Time curtains: fraction of [startTimestamp, endTimestamp] that is visible
  const [curtainFrac, setCurtainFrac]     = useState<[number, number]>([0, 1]);

  const portfolioColor = isDark ? '#EAEAEA' : '#1A2332';
  const showCrypto     = !!cryptoOverlay && cryptoCandles.length > 0;

  // Visible time range derived from curtain fractions
  const totalRange    = endTimestamp - startTimestamp;
  const visibleStartTs = startTimestamp + curtainFrac[0] * totalRange;
  const visibleEndTs   = startTimestamp + curtainFrac[1] * totalRange;
  const cryptoColor    = cryptoOverlay ? (CRYPTO_COLORS[cryptoOverlay] ?? '#F7931A') : '#F7931A';
  const legendColor    = isDark ? '#8B9DC3' : '#5A6A85';
  const tooltipBg      = isDark ? '#131A2A' : '#FFFFFF';
  const tooltipBorder  = isDark ? 'rgba(139,157,195,0.3)' : 'rgba(0,0,0,0.12)';

  // Available sources in current results (for filter chips)
  const availableSources = useMemo((): DataSource[] => {
    const srcs = new Set<string>();
    for (const r of results) { if (r.source) srcs.add(r.source); }
    return (['deribit', 'bybit', 'bybit-bs'] as DataSource[]).filter(s => srcs.has(s));
  }, [results]);

  // Results filtered by source toggle
  const visibleResults = useMemo(
    () => results.filter(r => !r.source || !hiddenSources.has(r.source)),
    [results, hiddenSources],
  );

  const toggleSourceFilter = useCallback((src: DataSource) => {
    setHiddenSources(prev => {
      const next = new Set(prev);
      next.has(src) ? next.delete(src) : next.add(src);
      return next;
    });
  }, []);

  const hasPolymarket = visibleResults.some(r => r.position.kind === 'polymarket');
  const hasOptions    = visibleResults.some(r => r.position.kind === 'deribit' || r.position.kind === 'futures');

  // ─── Normalised entry values ────────────────────────────────────────────────
  // For option groups with 3 sources (BS/Bybit/Deribit), all three have different
  // starting prices, making % incomparable. Normalise % to use the same reference:
  //   priority: bybit (real market) > deribit (exchange mark) > bybit-bs (theoretical)
  const normalizedEntryValues = useMemo((): Record<string, number> => {
    const groupOf = (r: BacktestResult): string | null => {
      for (const src of ['deribit', 'bybit', 'bybit-bs'] as const) {
        if (r.source === src && r.position.id.endsWith(`_${src}`)) {
          return r.position.id.slice(0, -(src.length + 1));
        }
      }
      return null;
    };
    const PRIORITY: Record<string, number> = { bybit: 0, deribit: 1, 'bybit-bs': 2 };
    const groupBest: Record<string, { priority: number; entryValue: number }> = {};
    for (const r of results) {
      if (!r.source || r.entryValue <= 0) continue;
      const gid = groupOf(r);
      if (!gid) continue;
      const p = PRIORITY[r.source] ?? 99;
      const ex = groupBest[gid];
      if (!ex || p < ex.priority) groupBest[gid] = { priority: p, entryValue: r.entryValue };
    }
    const out: Record<string, number> = {};
    for (const r of results) {
      const gid = groupOf(r);
      out[r.position.id] = (gid && groupBest[gid]) ? groupBest[gid].entryValue : r.entryValue;
    }
    return out;
  }, [results]);

  // Map from dataKey → { entryValue, qty, fee } for tooltip (option price + % P&L + fee)
  // Deribit curves are excluded from portfolio/options totals (display-only; BS is canonical)
  const entryInfoMap = useMemo((): Record<string, { entryValue: number; qty: number; fee?: number }> => {
    const m: Record<string, { entryValue: number; qty: number; fee?: number }> = {};
    let polyTotal = 0, optTotal = 0, total = 0;
    for (const r of visibleResults) {
      const qty = r.position.kind === 'futures'
        ? (r.position.futuresSize ?? 1)
        : (r.position.quantity ?? 0.01);
      const entryValue = normalizedEntryValues[r.position.id] ?? r.entryValue;
      m[r.position.id] = { entryValue, qty, fee: r.entryFee };
      if (r.source === 'bybit-bs' || !r.source) total += r.entryValue;
      if (r.position.kind === 'polymarket') polyTotal += r.entryValue;
      else if (r.source === 'bybit-bs') optTotal += r.entryValue;
    }
    m['polymarket_total'] = { entryValue: polyTotal, qty: 1 };
    m['options_total']    = { entryValue: optTotal,  qty: 1 };
    m['portfolio']        = { entryValue: total,      qty: 1 };
    return m;
  }, [visibleResults, normalizedEntryValues]);

  // ─── Legend items ───────────────────────────────────────────────────────────
  const legendItems = useMemo((): LegendItem[] => {
    const items: LegendItem[] = [];
    if (grouped) {
      if (hasPolymarket) items.push({ key: 'polymarket_total', label: 'Polymarket Total', color: POLY_COLOR, width: 2 });
      if (hasOptions)    items.push({ key: 'options_total',    label: 'Options Total',    color: OPT_COLOR,  width: 2 });
    } else {
      const typeIdx: Record<string, number> = {};
      const thicknesses = [2, 2.5, 1.75];
      for (const r of visibleResults) {
        const t = r.position.kind;
        typeIdx[t] = (typeIdx[t] ?? -1) + 1;
        const width = thicknesses[typeIdx[t] % thicknesses.length];
        const buy = isBuy(r.position);
        items.push({
          key: r.position.id, label: r.position.label,
          color: getPositionColor(r, isDark), dash: getLineDash(r), width,
          markerShape: buy ? 'circle' : 'x',
        });
      }
    }
    items.push({ key: 'portfolio', label: 'Total PnL', color: portfolioColor, width: 2 });
    if (showCrypto && cryptoOverlay) {
      items.push({ key: cryptoOverlay, label: `${cryptoOverlay} Price`, color: cryptoColor, dash: '4 2', width: 1.5 });
    }
    return items;
  }, [grouped, visibleResults, hasPolymarket, hasOptions, showCrypto, cryptoOverlay, cryptoColor, portfolioColor, isDark]);

  const handleGroupedChange = useCallback((_: unknown, val: boolean | null) => {
    if (val !== null) { setGrouped(val); setHiddenLines(new Set()); }
  }, []);

  const handleLegendClick = useCallback((key: string) => {
    setHiddenLines(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const allKeys = legendItems.map(i => i.key);
  const isAllVisible = hiddenLines.size === 0;
  const handleToggleAll = useCallback(() => {
    setHiddenLines(isAllVisible ? new Set(allKeys) : new Set());
  }, [isAllVisible, allKeys]);

  // ─── Right Y-axis (crypto price) range ─────────────────────────────────────
  const cryptoPriceRange = useMemo((): [number, number] | null => {
    if (!showCrypto || !cryptoCandles.length) return null;
    const max = Math.max(...cryptoCandles.map(c => c.h));
    const min = Math.min(...cryptoCandles.map(c => c.l));
    const mid = (min + max) / 2 + rightAxisOffset;
    const zoomed = (max - min) / 2 / rightAxisZoom;
    return [mid - zoomed, mid + zoomed];
  }, [showCrypto, cryptoCandles, rightAxisZoom, rightAxisOffset]);

  const handleShiftUp = useCallback(() => {
    if (!cryptoCandles.length) return;
    const max = Math.max(...cryptoCandles.map(c => c.h));
    const min = Math.min(...cryptoCandles.map(c => c.l));
    setRightAxisOffset(o => o - (max - min) * 0.1 / rightAxisZoom);
  }, [cryptoCandles, rightAxisZoom]);

  const handleShiftDown = useCallback(() => {
    if (!cryptoCandles.length) return;
    const max = Math.max(...cryptoCandles.map(c => c.h));
    const min = Math.min(...cryptoCandles.map(c => c.l));
    setRightAxisOffset(o => o + (max - min) * 0.1 / rightAxisZoom);
  }, [cryptoCandles, rightAxisZoom]);

  // ─── End-align offsets ──────────────────────────────────────────────────────
  // For each option group (same underlying, different sources), shift all curves
  // so their last visible data point coincides with the best-available reference.
  // Reference priority: bybit (real market) > deribit > bybit-bs.
  // Each option position is aligned independently — two strikes = two alignments.
  const endAlignOffsets = useMemo((): Record<string, number> => {
    if (!endAlign) return {};

    // Derive groupId from position.id: format is "${originalId}_${source}"
    const groupOf = (r: BacktestResult): string | null => {
      for (const src of ['deribit', 'bybit', 'bybit-bs'] as const) {
        if (r.source === src && r.position.id.endsWith(`_${src}`)) {
          return r.position.id.slice(0, -(src.length + 1));
        }
      }
      return null;
    };

    // Group by originalId
    const groups: Record<string, BacktestResult[]> = {};
    for (const r of results) {
      const gid = groupOf(r);
      if (!gid) continue;
      (groups[gid] ??= []).push(r);
    }

    const ALIGN_PRIORITY = ['bybit', 'deribit', 'bybit-bs'] as const;

    const offsets: Record<string, number> = {};
    for (const group of Object.values(groups)) {
      // Skip single-source groups — nothing to align
      if (group.length < 2) continue;

      // Find the best-available reference result
      let refResult: BacktestResult | null = null;
      let refLastPnl = 0;
      for (const src of ALIGN_PRIORITY) {
        const candidate = group.find(r => r.source === src);
        if (!candidate) continue;
        const filtered = candidate.pnlSeries.filter(
          pt => pt.timestamp >= visibleStartTs && pt.timestamp <= visibleEndTs
        );
        if (filtered.length === 0) continue;
        refResult = candidate;
        refLastPnl = filtered[filtered.length - 1].pnl;
        break;
      }
      if (!refResult) continue;

      // Shift all other sources to match the reference's last PnL
      for (const r of group) {
        if (r === refResult) continue;
        const filtered = r.pnlSeries.filter(
          pt => pt.timestamp >= visibleStartTs && pt.timestamp <= visibleEndTs
        );
        if (filtered.length === 0) continue;
        const lastPnl = filtered[filtered.length - 1].pnl;
        offsets[r.position.id] = refLastPnl - lastPnl;
      }
    }
    return offsets;
  }, [endAlign, results, visibleStartTs, visibleEndTs]);

  // ─── Chart data ─────────────────────────────────────────────────────────────
  // Build sorted, range-filtered, optionally downsampled timestamp list
  const chartData = useMemo((): ChartDataRow[] => {
    if (visibleResults.length === 0) return [];

    // Collect ALL timestamps from pnl series, filtered to visible range
    const allTs = new Set<number>();
    for (const r of visibleResults) {
      for (const pt of r.pnlSeries) {
        if (pt.timestamp >= visibleStartTs && pt.timestamp <= visibleEndTs) {
          allTs.add(pt.timestamp);
        }
      }
    }
    // Always include the range endpoints so lines start/end cleanly
    allTs.add(visibleStartTs);
    allTs.add(visibleEndTs);

    let sortedTs = Array.from(allTs).sort((a, b) => a - b);

    // Always cap to MAX_POINTS to keep rendering fast; smooth mode reduces further.
    const cap = smoothing ? MAX_SMOOTH_POINTS : MAX_POINTS;
    if (sortedTs.length > cap) {
      sortedTs = downsample(sortedTs, cap);
    }

    return sortedTs.map(ts => {
      const row: ChartDataRow = { timestamp: ts };
      let portfolio = 0, polyTotal = 0, optTotal = 0;
      for (const r of visibleResults) {
        const pnl = (findLastBefore(r.pnlSeries, ts) ?? 0) + (endAlignOffsets[r.position.id] ?? 0);
        row[r.position.id] = pnl;
        // Only bybit-bs counts toward totals — Deribit and Bybit are display-only comparisons
        if (r.source === 'bybit-bs' || !r.source) portfolio += pnl;
        if (r.position.kind === 'polymarket') polyTotal += pnl;
        else if (r.source === 'bybit-bs') optTotal += pnl;
      }
      row['portfolio']        = portfolio;
      row['polymarket_total'] = polyTotal;
      row['options_total']    = optTotal;
      if (showCrypto && cryptoOverlay) {
        const cp = findNearestClose(cryptoCandles, ts);
        if (cp !== null) row[`__${cryptoOverlay}_anchor__`] = cp;
      }
      return row;
    });
  }, [visibleResults, visibleStartTs, visibleEndTs, smoothing, showCrypto, cryptoOverlay, cryptoCandles]);

  // Raw PnL at first visible data point (used for % denominator and option price calc)
  const rawPnlBaselines = useMemo((): Record<string, number> => {
    if (chartData.length === 0) return {};
    const firstRow = chartData[0];
    const out: Record<string, number> = {};
    for (const key of Object.keys(firstRow)) {
      if (key !== 'timestamp') out[key] = (firstRow[key] as number) ?? 0;
    }
    return out;
  }, [chartData]);

  // Zero-normalised display data: shifts every curve so it starts at 0
  const displayData = useMemo((): ChartDataRow[] => {
    if (!zeroNorm || chartData.length === 0) return chartData;
    const firstRow = chartData[0];
    return chartData.map(row => {
      const shifted: ChartDataRow = { timestamp: row.timestamp };
      for (const key of Object.keys(row)) {
        if (key !== 'timestamp') {
          shifted[key] = (row[key] as number) - ((firstRow[key] as number) ?? 0);
        }
      }
      return shifted;
    });
  }, [chartData, zeroNorm]);

  // Tooltip baselines: 0 when zeroNorm (curves already start at 0), raw otherwise
  const pnlBaselines = useMemo((): Record<string, number> => {
    if (displayData.length === 0) return {};
    const firstRow = displayData[0];
    const out: Record<string, number> = {};
    for (const key of Object.keys(firstRow)) {
      if (key !== 'timestamp') out[key] = (firstRow[key] as number) ?? 0;
    }
    return out;
  }, [displayData]);

  // Marker indices: ~MARKERS_PER_LINE evenly-spaced indices per line
  const markerIndices = useMemo(() => {
    if (chartData.length === 0) return new Set<number>();
    const interval = Math.max(1, Math.floor(chartData.length / MARKERS_PER_LINE));
    const s = new Set<number>();
    for (let i = 0; i < chartData.length; i += interval) s.add(i);
    s.add(chartData.length - 1); // always mark last point
    return s;
  }, [chartData.length]);

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const visiblePositionLines = grouped ? [] : visibleResults.filter(r => !hiddenLines.has(r.position.id));

  // Per-type thickness cycling (mirrors legend)
  const typeIdx: Record<string, number> = {};
  const thicknesses = [2, 2.5, 1.75];
  function nextThickness(kind: string): number {
    typeIdx[kind] = (typeIdx[kind] ?? -1) + 1;
    return thicknesses[typeIdx[kind] % thicknesses.length];
  }

  const anchorKey = cryptoOverlay ? `__${cryptoOverlay}_anchor__` : '__none__';

  return (
    <Box>
      {/* Source filter + Smooth toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 0.5, pr: showCrypto ? '88px' : '24px', flexWrap: 'wrap' }}>
        {availableSources.map(src => {
          const hidden = hiddenSources.has(src);
          return (
            <Chip
              key={src}
              label={SOURCE_LABELS[src]}
              size="small"
              clickable
              variant={hidden ? 'outlined' : 'filled'}
              onClick={() => toggleSourceFilter(src)}
              sx={!hidden ? { bgcolor: SOURCE_COLORS[src], color: '#fff', fontSize: 11 } : { fontSize: 11 }}
            />
          );
        })}
        <button
          onClick={() => setSmoothing(s => !s)}
          style={{
            background: smoothing ? (isDark ? '#4A90D9' : '#1565C0') : 'transparent',
            border: `1px solid ${smoothing ? (isDark ? '#4A90D9' : '#1565C0') : legendColor}`,
            color: smoothing ? '#fff' : legendColor,
            fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', opacity: 0.9,
          }}
          title={smoothing ? `Showing ~${MAX_SMOOTH_POINTS} pts` : 'Show all data points'}
        >
          {smoothing ? `Smooth (${MAX_SMOOTH_POINTS}pt)` : 'Smooth'}
        </button>
        <button
          onClick={() => setEndAlign(v => !v)}
          style={{
            background: endAlign ? (isDark ? '#10B981' : '#059669') : 'transparent',
            border: `1px solid ${endAlign ? (isDark ? '#10B981' : '#059669') : legendColor}`,
            color: endAlign ? '#fff' : legendColor,
            fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', opacity: 0.9,
          }}
          title="Shift Deribit and Bybit curves so their final point matches BS — better visual alignment near expiry"
        >
          Align to expiry
        </button>
        <button
          onClick={() => setZeroNorm(v => !v)}
          style={{
            background: zeroNorm ? (isDark ? '#A78BFA' : '#7C3AED') : 'transparent',
            border: `1px solid ${zeroNorm ? (isDark ? '#A78BFA' : '#7C3AED') : legendColor}`,
            color: zeroNorm ? '#fff' : legendColor,
            fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', opacity: 0.9,
            display: 'flex', alignItems: 'center', gap: 3,
          }}
          title="Translate all PnL curves so they start from 0 at the left edge of the visible range"
        >
          <RestartAlt style={{ fontSize: 13 }} />
          Move to zero
        </button>
      </Box>
      {chartData.length === 0 ? (
        <Box sx={{ height: 440, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No data — enable a source above to display results
          </Typography>
        </Box>
      ) : (<>
      <ResponsiveContainer width="100%" height={440}>
        <ComposedChart data={displayData} margin={{ top: 20, right: 20, bottom: 10, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(139,157,195,0.12)' : 'rgba(0,0,0,0.08)'} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatDate}
            type="number"
            domain={[visibleStartTs, visibleEndTs]}
            tick={{ fill: isDark ? '#8B9DC3' : '#5A6A85', fontSize: 12 }}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={v => `$${(v as number).toFixed(2)}`}
            tick={{ fill: isDark ? '#8B9DC3' : '#5A6A85', fontSize: 12 }}
          />
          {showCrypto && cryptoPriceRange ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={cryptoPriceRange}
              tickFormatter={v => `$${Math.round(v as number).toLocaleString()}`}
              tick={{ fill: cryptoColor, fontSize: 12 }}
              width={65}
              label={{
                value: cryptoOverlay ? (CRYPTO_FULL_NAMES[cryptoOverlay] ?? cryptoOverlay) : '',
                angle: 90,
                position: 'insideRight',
                dx: 10,
                style: { fill: cryptoColor, fontSize: 13 },
              }}
            />
          ) : (
            <YAxis yAxisId="right" orientation="right" hide width={0} />
          )}

          {/* Anchor line — keeps right Y-axis scale initialised */}
          <Line
            yAxisId="right" dataKey={anchorKey}
            stroke="none" dot={false} legendType="none" isAnimationActive={false}
          />

          <RechartsTooltip
            contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 8 }}
            labelFormatter={ts =>
              new Date((ts as number) * 1000).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })
            }
            formatter={(value: number, name: string, props: { dataKey?: unknown }) => {
              if (!name || name.startsWith('__')) return null;
              if (name === cryptoOverlay) return [`$${Math.round(value).toLocaleString()}`, name];
              const dataKey = typeof props?.dataKey === 'string' ? props.dataKey : '';
              // Normalize PnL relative to first visible data point
              const baseline = pnlBaselines[dataKey] ?? 0;
              const normalizedValue = value - baseline;
              const info = entryInfoMap[dataKey];
              const entryVal = Math.abs(info?.entryValue ?? 0);
              // Denominator: position value at first visible point (uses raw baseline)
              const rawBaseline = rawPnlBaselines[dataKey] ?? 0;
              const visibleEntryVal = Math.abs(entryVal + rawBaseline);
              const pct = visibleEntryVal > 0.001
                ? `${normalizedValue >= 0 ? '+' : ''}${((normalizedValue / visibleEntryVal) * 100).toFixed(2)}%`
                : null;
              const label = dataKey === 'portfolio' ? 'Total PnL' : name;
              const sign = normalizedValue >= 0 ? '+' : '';

              // Option positions: show current option price prominently
              const isOption = visibleResults.some(
                r => r.position.id === dataKey && r.position.kind === 'deribit'
              );
              if (isOption) {
                const qty = info?.qty ?? 0.01;
                const entryPrice = entryVal / Math.abs(qty);
                // Reconstruct raw PnL (undo zero-norm shift) before removing endAlign offset
                const rawPnl = value + rawBaseline;
                const unshiftedPnl = rawPnl - (endAlignOffsets[dataKey] ?? 0);
                const currentPrice = entryPrice + unshiftedPnl / qty;
                const pctPart = pct ? ` / ${pct}` : '';
                return [`$${currentPrice.toFixed(2)} (${sign}$${Math.abs(normalizedValue).toFixed(2)}${pctPart})`, label];
              }

              const isFutures = visibleResults.some(r => r.position.id === dataKey && r.position.kind === 'futures');
              const pctLabel = isFutures && pct ? ` (${pct} on margin)` : pct ? ` (${pct})` : '';
              const feeLabel = (info?.fee ?? 0) > 0 ? ` · fee $${info!.fee!.toFixed(2)}` : '';
              return [`${sign}$${Math.abs(normalizedValue).toFixed(2)}${pctLabel}${feeLabel}`, label];
            }}
          />
          <ReferenceLine yAxisId="left" y={0} stroke={isDark ? 'rgba(139,157,195,0.4)' : 'rgba(0,0,0,0.2)'} />

          {/* Entry price reference lines for futures positions (right axis / price scale) */}
          {showCrypto && cryptoPriceRange && visibleResults
            .filter(r => r.position.kind === 'futures' && r.entryPrice != null && r.entryPrice > 0)
            .map(r => (
              <ReferenceLine
                key={`entry-${r.position.id}`}
                yAxisId="right"
                y={r.entryPrice}
                stroke={isDark ? 'rgba(210,215,220,0.6)' : 'rgba(70,75,80,0.5)'}
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Entry ${r.position.futuresSymbol ?? ''}`, position: 'insideTopRight', fontSize: 10, fill: isDark ? 'rgba(210,215,220,0.7)' : 'rgba(70,75,80,0.7)' }}
              />
            ))
          }

          {/* Individual position lines with buy/sell markers */}
          {visiblePositionLines.map(r => {
            const w     = nextThickness(r.position.kind);
            const buy   = isBuy(r.position);
            const color = getPositionColor(r, isDark);
            const dash  = getLineDash(r);
            return (
              <Line
                key={r.position.id}
                yAxisId="left" type="monotone"
                dataKey={r.position.id} name={r.position.label}
                stroke={color} strokeWidth={w} strokeDasharray={dash}
                dot={makeDotRenderer(buy, color, markerIndices)}
                activeDot={{ r: 6, fill: color }}
                isAnimationActive={false}
              />
            );
          })}

          {/* Grouped lines */}
          {grouped && hasPolymarket && !hiddenLines.has('polymarket_total') && (
            <Line yAxisId="left" type="monotone" dataKey="polymarket_total" name="Polymarket Total"
              stroke={POLY_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
          )}
          {grouped && hasOptions && !hiddenLines.has('options_total') && (
            <Line yAxisId="left" type="monotone" dataKey="options_total" name="Options Total"
              stroke={OPT_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
          )}

          {/* Total PnL */}
          {!hiddenLines.has('portfolio') && (
            <Line yAxisId="left" type="monotone" dataKey="portfolio" name="Total PnL"
              stroke={portfolioColor} dot={false} strokeWidth={2} isAnimationActive={false} />
          )}

          {/* Candlestick overlay */}
          {showCrypto && cryptoPriceRange && (
            <Customized
              component={CandlestickLayer}
              candles={cryptoCandles}
              xDomain={[visibleStartTs, visibleEndTs] as [number, number]}
              yDomain={cryptoPriceRange}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Time-range curtain slider */}
      <Box sx={{ px: '52px', pt: 0.5, pb: 0 }}>
        <Slider
          value={[Math.round(curtainFrac[0] * 1000), Math.round(curtainFrac[1] * 1000)]}
          min={0}
          max={1000}
          disableSwap
          size="small"
          onChange={(_, val) => {
            const [l, r] = val as number[];
            setCurtainFrac([l / 1000, r / 1000]);
          }}
          valueLabelDisplay="auto"
          valueLabelFormat={v =>
            new Date((startTimestamp + (v / 1000) * totalRange) * 1000)
              .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
          }
          sx={{
            '& .MuiSlider-track': { bgcolor: isDark ? '#4A90D9' : '#1565C0', opacity: 0.7 },
            '& .MuiSlider-rail': { bgcolor: isDark ? 'rgba(139,157,195,0.25)' : 'rgba(0,0,0,0.15)', opacity: 1 },
            '& .MuiSlider-thumb': { width: 14, height: 14 },
          }}
        />
      </Box>
      {/* Date range labels + reset */}
      <Box sx={{ px: '52px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <span style={{ fontSize: 11, color: isDark ? '#8B9DC3' : '#5A6A85' }}>
          {new Date(visibleStartTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        {(curtainFrac[0] > 0.001 || curtainFrac[1] < 0.999) && (
          <button
            onClick={() => setCurtainFrac([0, 1])}
            style={{
              background: 'transparent', border: `1px solid ${isDark ? '#8B9DC3' : '#5A6A85'}`,
              color: isDark ? '#8B9DC3' : '#5A6A85', fontSize: 11, padding: '1px 8px',
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
        <span style={{ fontSize: 11, color: isDark ? '#8B9DC3' : '#5A6A85' }}>
          {new Date(visibleEndTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </Box>
      </>)}

      {/* Controls */}
      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1.5, px: 1 }}>

        {/* Group toggle */}
        {hasPolymarket && hasOptions && (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <ToggleButtonGroup size="small" value={grouped} exclusive onChange={handleGroupedChange}>
              <ToggleButton value={false} sx={{ fontSize: 12, py: 0.5, px: 1.5 }}>Individual</ToggleButton>
              <ToggleButton value={true}  sx={{ fontSize: 12, py: 0.5, px: 1.5 }}>Grouped</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {/* Legend row */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px 16px' }}>

          {/* Legend items */}
          {legendItems.map(item => (
            <Box
              key={item.key}
              onClick={() => handleLegendClick(item.key)}
              sx={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                opacity: hiddenLines.has(item.key) ? 0.3 : 1, userSelect: 'none' }}
            >
              <svg width={28} height={14} style={{ display: 'block', flexShrink: 0 }}>
                <line x1={0} y1={7} x2={28} y2={7}
                  stroke={item.color} strokeWidth={item.width} strokeDasharray={item.dash} />
                {item.markerShape === 'circle' && (
                  <circle cx={14} cy={7} r={4} fill={item.color} />
                )}
                {item.markerShape === 'x' && (
                  <g stroke={item.color} strokeWidth={1.8} strokeLinecap="round">
                    <line x1={10} y1={3} x2={18} y2={11} />
                    <line x1={18} y1={3} x2={10} y2={11} />
                  </g>
                )}
              </svg>
              <span style={{ color: legendColor, fontSize: 13 }}>{item.label}</span>
            </Box>
          ))}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Box sx={{ width: '1px', height: 16, bgcolor: legendColor, opacity: 0.3 }} />
            <button
              onClick={handleToggleAll}
              style={{ background: 'transparent', border: `1px solid ${legendColor}`,
                color: legendColor, fontSize: 13, padding: '2px 10px', borderRadius: 4,
                cursor: 'pointer', opacity: 0.8, whiteSpace: 'nowrap' }}
            >
              {isAllVisible ? 'Hide All' : 'Show All'}
            </button>
          </Box>
        </Box>

        {/* Overlay + candle/zoom controls row */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px 16px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Button
              size="small"
              variant={cryptoOverlay ? 'contained' : 'outlined'}
              endIcon={<ExpandMore />}
              onClick={e => setOverlayAnchor(e.currentTarget)}
              color={cryptoOverlay === 'BTC' ? 'warning' : cryptoOverlay === 'ETH' ? 'primary' : 'inherit'}
              sx={{ fontSize: 12, py: 0.25, px: 1.25, minWidth: 0 }}
            >
              {cryptoOverlay ? `${cryptoOverlay} Overlay` : 'Overlay'}
            </Button>
            {showCrypto && (
              <>
                <ToggleButtonGroup
                  size="small" value={candleInterval} exclusive
                  onChange={(_, v) => { if (v) onCandleIntervalChange(v); }}
                >
                  {CANDLE_INTERVALS.map(iv => (
                    <ToggleButton key={iv} value={iv} sx={{ fontSize: 11, py: 0.25, px: 0.75 }}>{iv}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <Tooltip title="Zoom in price axis">
                    <IconButton size="small" onClick={() => setRightAxisZoom(z => Math.min(z * 1.5, 20))}>
                      <ZoomIn fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Zoom out price axis">
                    <IconButton size="small" onClick={() => setRightAxisZoom(z => Math.max(z / 1.5, 0.1))}>
                      <ZoomOut fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Shift up">
                    <IconButton size="small" onClick={handleShiftUp}>
                      <KeyboardArrowUp fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Shift down">
                    <IconButton size="small" onClick={handleShiftDown}>
                      <KeyboardArrowDown fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Reset price axis zoom and position">
                    <IconButton size="small" onClick={() => { setRightAxisZoom(1); setRightAxisOffset(0); }}>
                      <ZoomOutMap fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </>
            )}
          </Box>
          <Menu anchorEl={overlayAnchor} open={Boolean(overlayAnchor)} onClose={() => setOverlayAnchor(null)}>
            <MenuItem onClick={() => { onCryptoOverlayChange(null); setOverlayAnchor(null); setRightAxisZoom(1); setRightAxisOffset(0); }}>None</MenuItem>
            <MenuItem onClick={() => { onCryptoOverlayChange('BTC'); setOverlayAnchor(null); setRightAxisZoom(1); setRightAxisOffset(0); }}>BTC</MenuItem>
            <MenuItem onClick={() => { onCryptoOverlayChange('ETH'); setOverlayAnchor(null); setRightAxisZoom(1); setRightAxisOffset(0); }}>ETH</MenuItem>
          </Menu>
        </Box>
      </Box>
    </Box>
  );
}
