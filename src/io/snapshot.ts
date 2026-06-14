/**
 * snapshot.ts — unified save/load format for the hedging tool.
 *
 * One versioned envelope is shared by all three tabs (Builder, Backtester,
 * Finder). It is card-based: positions are stored as PositionCard[] (the
 * Builder's native shape), with the heavy live option chain stripped (it is
 * re-fetched on load). Optional `view` carries Builder display state and
 * optional `backtest` carries lossless Backtester data.
 *
 * Legacy formats (`builder_full_save`, `builder_snapshot`,
 * `position_hedger_snapshot_v1`, bare BacktestPosition[]) are intentionally
 * NOT read — old files must be re-exported from the current app.
 */

import { toBlob } from 'html-to-image';
import type {
  PositionCard,
  OptionsCardData,
  BacktestPosition,
  CryptoOption,
  OptionType,
} from '../types';

export const SNAPSHOT_FORMAT = 'shtanga.hedging' as const;
export const SNAPSHOT_VERSION = 2 as const;

export type SnapshotApp = 'builder' | 'backtester' | 'finder';

export interface SnapshotView {
  spotPrice?: number;
  priceRange?: [number, number];
  crypto?: CryptoOption | null;
  optionType?: OptionType;
}

export interface SnapshotBacktest {
  positions: BacktestPosition[];
  startDate?: string;
  endDate?: string;
}

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  schemaVersion: typeof SNAPSHOT_VERSION;
  app: SnapshotApp;
  savedAt: string; // ISO timestamp
  cards: PositionCard[];
  view?: SnapshotView;
  backtest?: SnapshotBacktest;
}

/** Strip the live Bybit option chain (large + holds a Map) from options cards.
 *  The chain is re-fetched on load; baseCoin/priceMode/selectedOptions are kept. */
export function serializeCards(cards: PositionCard[]): PositionCard[] {
  return cards.map(card => {
    if (card.kind === 'options') {
      const d = card.data as OptionsCardData;
      return {
        id: card.id,
        kind: card.kind,
        data: {
          baseCoin: d.baseCoin ?? d.chain?.baseCoin,
          chain: null,
          priceMode: d.priceMode,
          selectedOptions: d.selectedOptions,
          minimized: d.minimized,
        } as OptionsCardData,
      };
    }
    return { id: card.id, kind: card.kind, data: card.data };
  });
}

/** Fill in defaults for any option legs missing required numeric fields so a
 *  loaded snapshot can never crash the chart renderer. Mutates in place. */
function normalizeCards(cards: PositionCard[]): PositionCard[] {
  for (const card of cards) {
    if (card.kind !== 'options') continue;
    const d = card.data as OptionsCardData;
    for (const opt of d.selectedOptions ?? []) {
      if (opt.entryPrice == null) opt.entryPrice = 0;
      if (opt.quantity == null) opt.quantity = 0.01;
      if (opt.markIv == null) opt.markIv = 0;
    }
  }
  return cards;
}

export function buildSnapshot(
  app: SnapshotApp,
  cards: PositionCard[],
  extras?: { view?: SnapshotView; backtest?: SnapshotBacktest },
): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: SNAPSHOT_VERSION,
    app,
    savedAt: new Date().toISOString(),
    cards: serializeCards(cards),
    ...(extras?.view ? { view: extras.view } : {}),
    ...(extras?.backtest ? { backtest: extras.backtest } : {}),
  };
}

export class SnapshotFormatError extends Error {}

/** Validate + normalize raw parsed JSON into a Snapshot. Throws SnapshotFormatError
 *  with a user-facing message if the file isn't a current-format snapshot. */
export function parseSnapshot(raw: unknown): Snapshot {
  if (!raw || typeof raw !== 'object') {
    throw new SnapshotFormatError('Not a valid JSON snapshot file.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== SNAPSHOT_FORMAT) {
    throw new SnapshotFormatError(
      'Unrecognized file format. Please upload a snapshot exported from this app. ' +
      'Files saved by older versions are no longer supported — re-export them here.',
    );
  }
  if (obj.schemaVersion !== SNAPSHOT_VERSION) {
    throw new SnapshotFormatError(
      `Unsupported snapshot version (${String(obj.schemaVersion)}). This app reads version ${SNAPSHOT_VERSION}.`,
    );
  }
  if (!Array.isArray(obj.cards)) {
    throw new SnapshotFormatError('Snapshot is missing its positions ("cards").');
  }
  const snap = obj as unknown as Snapshot;
  normalizeCards(snap.cards);
  return snap;
}

/** Returns true if any loaded option leg has already expired (caller may warn). */
export function findExpiredOption(cards: PositionCard[], nowMs: number = Date.now()): number | null {
  for (const card of cards) {
    if (card.kind !== 'options') continue;
    const d = card.data as OptionsCardData;
    for (const opt of d.selectedOptions ?? []) {
      if (opt.expiryTimestamp && opt.expiryTimestamp < nowMs) return opt.expiryTimestamp;
    }
  }
  return null;
}

// ─── Download helpers ─────────────────────────────────────────────────────────

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render a DOM element to a PNG download. Never throws — returns false if the
 *  capture failed (e.g. tainted canvas / unsupported fonts). */
export async function downloadElementPng(
  el: HTMLElement | null,
  filename: string,
): Promise<boolean> {
  if (!el) return false;
  try {
    const blob = await toBlob(el, { pixelRatio: 2 });
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.warn('[snapshot] chart PNG export failed:', err);
    return false;
  }
}

/** Read a File as parsed JSON. Rejects with a friendly message on failure. */
export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new SnapshotFormatError('Failed to read file.'));
    reader.onload = (ev) => {
      try {
        resolve(JSON.parse(ev.target?.result as string));
      } catch {
        reject(new SnapshotFormatError('File is not valid JSON.'));
      }
    };
    reader.readAsText(file);
  });
}
