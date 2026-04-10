export interface Market {
  id: string;
  question: string;
  groupItemTitle: string;
  groupItemThreshold: number;
  endDate: number; // Unix timestamp (seconds)
  startDate: number; // Unix timestamp (seconds)
  clobTokenIds: string; // JSON-encoded string
  outcomePrices: string; // JSON-encoded string e.g. '["0.85","0.15"]'
  bestBid?: string | number; // YES token best bid (CLOB top-of-book)
  bestAsk?: string | number; // YES token best ask (CLOB top-of-book)
}

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  startDate: number; // Unix timestamp (seconds)
  endDate: number; // Unix timestamp (seconds)
  markets: Market[];
  series?: {
    cgAssetName?: string;
    seriesSlug?: string;
  };
}

export interface PricePoint {
  t: number; // Unix timestamp
  p: number; // Price
}

export interface PriceHistory {
  history: PricePoint[];
}

export interface ParsedMarket {
  id: string;
  question: string;
  groupItemTitle: string;
  groupItemThreshold: number;
  endDate: number; // Unix timestamp (seconds)
  startDate: number; // Unix timestamp (seconds)
  yesTokenId: string;
  noTokenId: string;
  currentPrice: number; // YES outcome price mid (0-1)
  bestBid?: number;     // YES token best bid (0-1); undefined if not available
  bestAsk?: number;     // YES token best ask (0-1); undefined if not available
  strikePrice: number; // Parsed strike price from groupItemTitle
}

export type CryptoOption = 'BTC' | 'ETH' | 'SOL' | 'XRP';

export type OptionType = 'above' | 'hit';

export type Side = 'YES' | 'NO';

export interface ProjectionPoint {
  cryptoPrice: number;
  pnl: number;
}

export interface SelectedStrike {
  marketId: string;
  question: string;
  groupItemTitle: string;
  strikePrice: number;
  side: Side;
  entryPrice: number; // Price paid (YES price for YES, 1-YES price for NO)
  impliedVol: number; // Calibrated IV (same for YES/NO)
  isUpBarrier: boolean; // For hit-type: true if strike > spot (need price to rise)
}

// --- Bybit types ---

export interface BybitInstrument {
  symbol: string;           // e.g. "BTC-28FEB25-100000-C"
  optionsType: 'Call' | 'Put';
  strike: number;
  expiryTimestamp: number;  // Unix ms
}

export interface BybitTicker {
  symbol: string;
  bid1Price: number;
  ask1Price: number;
  markPrice: number;
  markIv: number;           // annualized IV from Bybit (0-1 scale, e.g. 0.55 = 55%)
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

export interface BybitOptionChain {
  expiryLabel: string;      // e.g. "28 Feb 2025"
  expiryTimestamp: number;  // Unix ms
  instruments: BybitInstrument[];
  tickers: Map<string, BybitTicker>;
}

export type BybitSide = 'buy' | 'sell';

export interface BybitPosition {
  symbol: string;
  optionsType: 'Call' | 'Put';
  strike: number;
  expiryTimestamp: number;  // Unix ms
  side: BybitSide;
  entryPrice: number;       // premium in USD
  markIv: number;
  quantity: number;
  entryFee: number;         // trading fee in USD
}

export interface PolymarketPosition extends SelectedStrike {
  quantity: number;
  entryFee: number; // Polymarket taker fee in USD (0 for bid/maker mode)
  optionType: OptionType; // per-position: 'above' or 'hit' (from the event this position belongs to)
  endDate: number; // per-position expiry in Unix seconds (from the market's endDate)
}

// --- Optimization types ---

export interface OptMatchResult {
  instrument: BybitInstrument;     // Long Bybit option (buy leg)
  ticker: BybitTicker;
  shortInstrument: BybitInstrument; // Short Bybit option at poly strike (sell leg)
  shortTicker: BybitTicker;
  polyQty: number;       // Polymarket quantity derived from hedge constraint
  noAskPrice: number;    // Entry price for Polymarket position (NO ask for NO side, YES ask for YES side)
  hedgeSide: 'YES' | 'NO'; // Which poly side this hedge is for
  bybitAsk: number;      // Bybit ask price at entry (long leg)
  bybitFee: number;      // Entry fee for long bybit position (total, already × qty)
  shortBid: number;      // Bybit bid price received at entry (short leg)
  shortFee: number;      // Entry fee for short bybit position (total, already × qty)
  avgPnl1: number;       // Average combined 3-leg P&L in ±1% range
  avgPnl10: number;      // Average combined 3-leg P&L in ±10% range
  avgPnl20: number;      // Average combined 3-leg P&L in ±20% range
  tauPolyRem: number;    // Poly time-to-expiry remaining at evaluation (years)
  tauBybitRem: number;   // Bybit time-to-expiry remaining at evaluation (years)
  tauEval: number;       // Time until evaluation point from now (years)
}

export interface StrikeOptResult {
  market: ParsedMarket;
  isUpBarrier: boolean;
  polyIv: number;        // Calibrated IV for this poly strike at current spot
  best1: OptMatchResult | null;   // Best match ranked by avgPnl1
  best10: OptMatchResult | null;  // Best match ranked by avgPnl10
  best20: OptMatchResult | null;  // Best match ranked by avgPnl20
}

// --- Unified position card types for Position Builder ---

export type PositionKind = 'polymarket' | 'options' | 'futures';

export interface PolymarketCardData {
  event: PolymarketEvent | null;
  optionType: OptionType;
  crypto: CryptoOption | null;
  markets: ParsedMarket[];
  selections: { marketId: string; side: Side; quantity: number; entryPrice: number }[];
  minimized: boolean;
}

export interface OptionsCardData {
  chain: BybitOptionChain | null;
  selectedOptions: {
    symbol: string;
    optionsType: 'Call' | 'Put';
    strike: number;
    expiryTimestamp: number;
    side: BybitSide;
    quantity: number;
    entryPrice: number;
    markIv: number;
  }[];
  minimized: boolean;
}

export interface FuturesCardData {
  symbol: string;
  entryPrice: number;
  size: number; // positive = long, negative = short
  leverage: number; // default 5
  minimized: boolean;
}

export interface PositionCard {
  id: string;
  kind: PositionKind;
  data: PolymarketCardData | OptionsCardData | FuturesCardData;
}

// --- Backtester types ---

export interface BacktestPosition {
  id: string;
  kind: 'polymarket' | 'deribit' | 'futures';
  label: string;
  color: string;
  // polymarket
  tokenId?: string;
  polySide?: 'YES' | 'NO';
  polyEventSlug?: string;
  // deribit / bybit options
  instrumentName?: string; // e.g. "BTC-28MAR25-100000-C" or "BTC-28MAR25-100000-C-USDT"
  quantity?: number;
  // Which data sources to use for this option card (multi-select; defaults to ['deribit'])
  enabledSources?: ('deribit' | 'bybit' | 'bybit-bs')[];
  // BS reconstruction fields (needed for bybit-bs source)
  optStrike?: number;
  optExpiryMs?: number;  // Unix ms
  optType?: 'Call' | 'Put';
  // futures
  futuresSymbol?: string;   // e.g. "BTC" — fetches Binance klines
  futuresSize?: number;     // positive = long, negative = short
  futuresLeverage?: number; // default 5; used to compute margin for % PnL
  // shared
  entryTimestamp: number; // Unix seconds
  entryPrice: number;
  minimized?: boolean;
}

export interface DeribitCandle {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
}

// --- Transfer payload for "Send to Position Builder" ---

export interface BuilderTransferPayload {
  version: '1.0';
  polyEvent: PolymarketEvent | null;
  polyMarkets: ParsedMarket[];
  polySelections: { marketId: string; side: Side; quantity: number; entryPrice: number }[];
  bybitChainData: {
    expiryLabel: string;
    expiryTimestamp: number;
    instruments: BybitInstrument[];
    tickers: { symbol: string; bid1Price: number; ask1Price: number; markPrice: number; markIv: number; delta: number; gamma: number; vega: number; theta: number }[];
  } | null;
  bybitSelections: {
    symbol: string;
    optionsType: 'Call' | 'Put';
    strike: number;
    expiryTimestamp: number;
    side: BybitSide;
    quantity: number;
    entryPrice: number;
    markIv: number;
  }[];
  crypto: CryptoOption | null;
  optionType: OptionType;
  spotPrice: number;
}
