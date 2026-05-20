import { useRef, useState } from 'react';
import { Box } from '@mui/material';

/**
 * Custom range curtain that sits on a chart's X-axis.
 *
 * - Outside the selected band is dimmed ("curtains"); brackets `[` and `]`
 *   are draggable handles, and the mid-band can be dragged to shift the
 *   whole window.
 * - Double-click on `[` or `]` swaps the bracket for a numeric input
 *   pre-filled with the current edge value; Enter/blur commits, Esc cancels.
 * - `step` snaps drag values to multiples of `step` (0 = no snapping).
 * - `formatValue`/`parseValue` let callers handle non-price units
 *   (e.g. date-formatted timestamps).
 *
 * Ported from deltaforge_extension/position_builder.
 */
interface RangeCurtainProps {
  fullBounds: [number, number];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  isDark: boolean;
  step?: number;
  /** Format a numeric value for display in the edit input (default: toFixed(0)). */
  formatValue?: (v: number) => string;
  /** Parse an edit input string back to a number (default: parseFloat). */
  parseValue?: (s: string) => number;
  /** Width of the edit input that replaces the bracket while editing. */
  editInputWidth?: number;
  /** Optional input type for the edit field. Default 'number'. */
  editInputType?: 'number' | 'text' | 'date' | 'datetime-local';
}

const MONO_FONT = 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace';

export function RangeCurtain({
  fullBounds,
  value,
  onChange,
  isDark,
  step = 0,
  formatValue,
  parseValue,
  editInputWidth = 90,
  editInputType = 'number',
}: RangeCurtainProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ which: 'lo' | 'hi' | 'mid' | null; startX: number; startLo: number; startHi: number; trackW: number }>({
    which: null, startX: 0, startLo: 0, startHi: 0, trackW: 0,
  });

  const [editing, setEditing] = useState<'lo' | 'hi' | null>(null);
  const [editText, setEditText] = useState<string>('');

  const [lo, hi] = value;
  const [boundLo, boundHi] = fullBounds;
  const span = Math.max(boundHi - boundLo, 1);
  const loPct = Math.min(100, Math.max(0, ((lo - boundLo) / span) * 100));
  const hiPct = Math.min(100, Math.max(0, ((hi - boundLo) / span) * 100));

  const fmt = formatValue ?? ((v: number) => v.toFixed(0));
  const parse = parseValue ?? ((s: string) => parseFloat(s.replace(/,/g, '')));

  const axisColor = isDark ? '#8B9DC3' : '#5A6A85';
  const dimColor  = isDark ? 'rgba(10, 14, 20, 0.58)' : 'rgba(220, 225, 235, 0.7)';
  const trackBg   = isDark ? 'rgba(168, 180, 199, 0.18)' : 'rgba(90, 106, 133, 0.15)';
  const activeBg  = isDark ? 'rgba(109, 143, 191, 0.62)' : 'rgba(79, 131, 209, 0.5)';

  const snap = (v: number) => (step > 0 ? Math.round(v / step) * step : v);
  const minGap = Math.max(span * 0.02, step * 2);

  const onPointerDown = (which: 'lo' | 'hi' | 'mid') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      which,
      startX: e.clientX,
      startLo: lo,
      startHi: hi,
      trackW: trackRef.current.getBoundingClientRect().width,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.which || d.trackW <= 0) return;
    const dx = e.clientX - d.startX;
    const dPrice = (dx / d.trackW) * span;
    if (d.which === 'lo') {
      const next = snap(Math.min(Math.max(d.startLo + dPrice, boundLo), d.startHi - minGap));
      onChange([next, d.startHi]);
    } else if (d.which === 'hi') {
      const next = snap(Math.max(Math.min(d.startHi + dPrice, boundHi), d.startLo + minGap));
      onChange([d.startLo, next]);
    } else {
      const width = d.startHi - d.startLo;
      let nextLo = snap(d.startLo + dPrice);
      let nextHi = nextLo + width;
      if (nextLo < boundLo) { nextLo = boundLo; nextHi = boundLo + width; }
      if (nextHi > boundHi) { nextHi = boundHi; nextLo = boundHi - width; }
      onChange([nextLo, nextHi]);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current.which = null;
  };

  const startEdit = (which: 'lo' | 'hi') => {
    const v = which === 'lo' ? lo : hi;
    setEditing(which);
    setEditText(fmt(v));
  };
  const commitEdit = () => {
    if (!editing) return;
    const parsed = parse(editText);
    if (Number.isFinite(parsed)) {
      if (editing === 'lo') {
        const next = snap(Math.min(Math.max(parsed, boundLo), hi - minGap));
        if (next !== lo) onChange([next, hi]);
      } else {
        const next = snap(Math.max(Math.min(parsed, boundHi), lo + minGap));
        if (next !== hi) onChange([lo, next]);
      }
    }
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);

  const editInputSx = {
    width: editInputWidth,
    height: 22,
    fontSize: 12,
    fontFamily: MONO_FONT,
    fontWeight: 700,
    color: isDark ? '#EEF4FF' : '#0F1620',
    background: isDark ? '#0E141D' : '#FFFFFF',
    border: `1px solid ${isDark ? '#4E6F9F' : '#4F83D1'}`,
    borderRadius: 4,
    outline: 'none',
    textAlign: 'center' as const,
    padding: '0 4px',
  };

  return (
    <Box
      ref={trackRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: 18,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* left curtain (dimmed) */}
      <Box sx={{ position: 'absolute', left: 0, width: `${loPct}%`, top: 0, bottom: 0, bgcolor: dimColor, pointerEvents: 'none' }} />
      {/* right curtain (dimmed) */}
      <Box sx={{ position: 'absolute', left: `${hiPct}%`, right: 0, top: 0, bottom: 0, bgcolor: dimColor, pointerEvents: 'none' }} />
      {/* active band */}
      <Box sx={{ position: 'absolute', left: `${loPct}%`, width: `${hiPct - loPct}%`, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: activeBg, pointerEvents: 'none' }} />
      {/* faint base track outside active band */}
      <Box sx={{ position: 'absolute', left: 0, width: `${loPct}%`, top: '50%', height: 1, transform: 'translateY(-50%)', bgcolor: trackBg, pointerEvents: 'none' }} />
      <Box sx={{ position: 'absolute', left: `${hiPct}%`, right: 0, top: '50%', height: 1, transform: 'translateY(-50%)', bgcolor: trackBg, pointerEvents: 'none' }} />
      {/* mid drag region */}
      <Box
        onPointerDown={onPointerDown('mid')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        sx={{
          position: 'absolute',
          left: `${loPct}%`,
          width: `${hiPct - loPct}%`,
          top: 0, bottom: 0,
          cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
        }}
      />
      {/* [ handle */}
      <Box
        onPointerDown={editing === 'lo' ? undefined : onPointerDown('lo')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => startEdit('lo')}
        sx={{
          position: 'absolute',
          left: `${loPct}%`,
          transform: 'translateX(-50%)',
          top: 0,
          bottom: 0,
          width: editing === 'lo' ? editInputWidth + 6 : 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: editing === 'lo' ? 'text' : 'ew-resize',
          color: axisColor,
          fontFamily: MONO_FONT,
          fontWeight: 700,
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {editing === 'lo' ? (
          <input
            autoFocus
            type={editInputType}
            inputMode={editInputType === 'number' ? 'decimal' : undefined}
            step={editInputType === 'number' && step > 0 ? step : undefined}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={editInputSx}
          />
        ) : '['}
      </Box>
      {/* ] handle */}
      <Box
        onPointerDown={editing === 'hi' ? undefined : onPointerDown('hi')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => startEdit('hi')}
        sx={{
          position: 'absolute',
          left: `${hiPct}%`,
          transform: 'translateX(-50%)',
          top: 0,
          bottom: 0,
          width: editing === 'hi' ? editInputWidth + 6 : 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: editing === 'hi' ? 'text' : 'ew-resize',
          color: axisColor,
          fontFamily: MONO_FONT,
          fontWeight: 700,
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {editing === 'hi' ? (
          <input
            autoFocus
            type={editInputType}
            inputMode={editInputType === 'number' ? 'decimal' : undefined}
            step={editInputType === 'number' && step > 0 ? step : undefined}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={editInputSx}
          />
        ) : ']'}
      </Box>
    </Box>
  );
}
