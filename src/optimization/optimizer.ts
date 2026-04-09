import type { ParsedMarket, OptionType, BybitOptionChain, BybitInstrument, OptMatchResult, StrikeOptResult } from '../types';
import { priceHit, priceAbove, bsPrice, bybitTradingFee, solveImpliedVol, autoH } from '../pricing/engine';

const YEAR_SEC = 365.25 * 24 * 3600;
const NUM_GRID = 200;
// Allow a small tolerance for floating-point near-zero negatives
const FEASIBILITY_EPSILON = -0.001;

/**
 * Run optimization for all Polymarket strikes against a Bybit option chain.
 *
 * 3-leg position:
 *   1. Poly NO or YES (sized by hedge constraint)
 *   2. Long Bybit option
 *   3. Short Bybit option (spread leg)
 *
 * For NO side (default):
 *   - CALL spread for up-barrier, PUT spread for down-barrier
 *   - Constraint: combined P&L = 0 at poly strike K (where NO loses maximally)
 *
 * For YES side:
 *   - PUT spread for up-barrier (hedge downside), CALL spread for down-barrier (hedge upside)
 *   - Constraint: combined P&L = 0 at ±20% boundary (where YES loses maximally)
 *
 * Feasibility: no negative combined P&L in ±20% around spot price.
 * Score: average P&L in ±1%, ±10%, ±20% ranges.
 */
export function runOptimization(
  polyMarkets: ParsedMarket[],
  optionType: OptionType,
  spotPrice: number,
  nowSec: number,
  bybitChain: BybitOptionChain,
  bybitQty: number = 0.01,
  side: 'YES' | 'NO' = 'NO',
): StrikeOptResult[] {
  const results: StrikeOptResult[] = [];

  for (const market of polyMarkets) {
    if (market.strikePrice <= 0) continue;

    const tauPoly = Math.max((market.endDate - nowSec) / YEAR_SEC, 0);
    if (tauPoly <= 0) continue;

    const isUpBarrier = market.strikePrice > spotPrice;

    // Bybit option type:
    // NO up-barrier → CALL; NO down-barrier → PUT
    // YES up-barrier → PUT (hedge downside); YES down-barrier → CALL (hedge upside)
    const matchingType = (side === 'NO' ? isUpBarrier : !isUpBarrier) ? 'Call' : 'Put';

    // Poly entry price (cost per contract at market)
    const polyEntryPrice = side === 'YES'
      ? ((market.bestAsk != null && market.bestAsk > 0) ? market.bestAsk : market.currentPrice)
      : (1 - ((market.bestBid != null && market.bestBid > 0) ? market.bestBid : market.currentPrice));

    if (polyEntryPrice < 0.01 || polyEntryPrice > 0.9999) continue;

    // Calibrate poly implied vol
    const hNow = autoH(tauPoly);
    const polyIv = solveImpliedVol(
      spotPrice, market.strikePrice, tauPoly,
      market.currentPrice, optionType, isUpBarrier, hNow,
    );
    if (polyIv === null || polyIv <= 0) {
      results.push({ market, isUpBarrier, polyIv: 0, best1: null, best10: null, best20: null });
      continue;
    }

    // Short leg anchor:
    // CALL short: lowest CALL ≥ K  (for NO up-barrier or YES down-barrier)
    // PUT short: highest PUT ≤ K   (for NO down-barrier or YES up-barrier)
    const K = market.strikePrice;
    const sameTypeCandidates = bybitChain.instruments.filter(i => i.optionsType === matchingType);

    let shortInst: BybitInstrument | null = null;
    if (matchingType === 'Call') {
      const above = sameTypeCandidates
        .filter(i => i.strike >= K)
        .sort((a, b) => a.strike - b.strike);
      shortInst = above[0] ?? null;
    } else {
      const below = sameTypeCandidates
        .filter(i => i.strike <= K)
        .sort((a, b) => b.strike - a.strike);
      shortInst = below[0] ?? null;
    }

    if (!shortInst) {
      results.push({ market, isUpBarrier, polyIv, best1: null, best10: null, best20: null });
      continue;
    }

    const shortTicker = bybitChain.tickers.get(shortInst.symbol);
    const shortBid = shortTicker?.bid1Price ?? 0;
    if (!shortTicker || shortBid <= 0 || shortTicker.markIv <= 0) {
      results.push({ market, isUpBarrier, polyIv, best1: null, best10: null, best20: null });
      continue;
    }

    const shortFee = bybitTradingFee(spotPrice, shortBid, bybitQty);

    let best1: OptMatchResult | null = null;
    let best10: OptMatchResult | null = null;
    let best20: OptMatchResult | null = null;

    const longCandidates = sameTypeCandidates.filter(
      inst => inst.symbol !== shortInst!.symbol,
    );

    for (const inst of longCandidates) {
      const ticker = bybitChain.tickers.get(inst.symbol);
      if (!ticker) continue;

      const bybitAsk = ticker.ask1Price;
      if (bybitAsk <= 0 || ticker.markIv <= 0) continue;

      const tauBybit = Math.max(((inst.expiryTimestamp / 1000) - nowSec) / YEAR_SEC, 0);
      if (tauBybit <= 0) continue;

      const tauEval = Math.min(tauPoly, tauBybit);
      const tauPolyRem = tauPoly - tauEval;
      const tauBybitRem = tauBybit - tauEval;

      const bybitFee = bybitTradingFee(spotPrice, bybitAsk, bybitQty);

      // Constraint evaluation price:
      // NO: evaluate at K (NO has maximum loss when price = K → YES hits)
      // YES: evaluate at ±20% boundary (YES has maximum loss when price is far from K)
      const constraintEvalPrice = side === 'NO'
        ? K
        : (isUpBarrier ? 0.8 * spotPrice : 1.2 * spotPrice);

      // Option values at constraint eval price
      const longValueAtConstraint = bsPrice(
        constraintEvalPrice, inst.strike, ticker.markIv, tauBybitRem, inst.optionsType,
      );
      const longProfitAtConstraint = (longValueAtConstraint - bybitAsk) * bybitQty - bybitFee;

      const shortValueAtConstraint = bsPrice(
        constraintEvalPrice, shortInst.strike, shortTicker.markIv, tauBybitRem, shortInst.optionsType,
      );
      const shortPnlAtConstraint = (shortBid - shortValueAtConstraint) * bybitQty - shortFee;

      const netOptionProfitAtConstraint = longProfitAtConstraint + shortPnlAtConstraint;
      if (netOptionProfitAtConstraint <= 0) continue;

      // polyYes at constraint eval price (used for YES denominator)
      let polyYesAtConstraint: number;
      if (side === 'NO') {
        // At K for NO: YES hits, polyYes = 1
        polyYesAtConstraint = 1;
      } else if (tauPolyRem <= 0) {
        if (optionType === 'above') {
          polyYesAtConstraint = constraintEvalPrice >= K ? 1 : 0;
        } else {
          polyYesAtConstraint = isUpBarrier ? (constraintEvalPrice >= K ? 1 : 0) : (constraintEvalPrice <= K ? 1 : 0);
        }
      } else {
        const hAtEval = autoH(tauPolyRem);
        polyYesAtConstraint = optionType === 'above'
          ? priceAbove(constraintEvalPrice, K, polyIv, tauPolyRem, hAtEval)
          : priceHit(constraintEvalPrice, K, polyIv, tauPolyRem, isUpBarrier, hAtEval);
      }

      // Hedge constraint: combined P&L = 0 at constraint eval price
      // NO: loss = noAskPrice * polyQty, so polyQty = netOption / noAskPrice
      // YES: loss = (yesAskPrice - polyYesAtConstraint) * polyQty,
      //      so polyQty = netOption / (yesAskPrice - polyYesAtConstraint)
      const hedgeDenominator = side === 'NO'
        ? polyEntryPrice
        : Math.max(polyEntryPrice - polyYesAtConstraint, 0.001);

      const polyQty = Math.round(netOptionProfitAtConstraint / hedgeDenominator);
      if (polyQty <= 0) continue;

      // Build P&L grid over ±20% around current spot price
      const lower = 0.8 * spotPrice;
      const upper = 1.2 * spotPrice;
      const step = (upper - lower) / (NUM_GRID - 1);

      let feasible = true;
      const gridPnl: number[] = new Array(NUM_GRID);

      for (let i = 0; i < NUM_GRID; i++) {
        const S = lower + step * i;

        let polyYes: number;
        if (tauPolyRem <= 0) {
          if (optionType === 'above') {
            polyYes = S >= K ? 1 : 0;
          } else {
            polyYes = isUpBarrier ? (S >= K ? 1 : 0) : (S <= K ? 1 : 0);
          }
        } else {
          const hAtEval = autoH(tauPolyRem);
          polyYes = optionType === 'above'
            ? priceAbove(S, K, polyIv, tauPolyRem, hAtEval)
            : priceHit(S, K, polyIv, tauPolyRem, isUpBarrier, hAtEval);
        }

        const polyPnl = side === 'NO'
          ? ((1 - polyYes) - polyEntryPrice) * polyQty
          : (polyYes - polyEntryPrice) * polyQty;

        const longValue = bsPrice(S, inst.strike, ticker.markIv, tauBybitRem, inst.optionsType);
        const longPnl = (longValue - bybitAsk) * bybitQty - bybitFee;

        const shortValue = bsPrice(S, shortInst.strike, shortTicker.markIv, tauBybitRem, shortInst.optionsType);
        const shortPnl = (shortBid - shortValue) * bybitQty - shortFee;

        const combined = polyPnl + longPnl + shortPnl;
        gridPnl[i] = combined;

        if (combined < FEASIBILITY_EPSILON) {
          feasible = false;
          break;
        }
      }

      if (!feasible) continue;

      const avgInRange = (lo: number, hi: number): number => {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < NUM_GRID; i++) {
          const S = lower + step * i;
          if (S >= lo && S <= hi) {
            sum += gridPnl[i];
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      };

      const avgPnl1  = avgInRange(0.99 * spotPrice, 1.01 * spotPrice);
      const avgPnl10 = avgInRange(0.90 * spotPrice, 1.10 * spotPrice);
      const avgPnl20 = avgInRange(0.80 * spotPrice, 1.20 * spotPrice);

      const match: OptMatchResult = {
        instrument: inst,
        ticker,
        shortInstrument: shortInst,
        shortTicker,
        polyQty,
        noAskPrice: polyEntryPrice,
        hedgeSide: side,
        bybitAsk,
        bybitFee,
        shortBid,
        shortFee,
        avgPnl1,
        avgPnl10,
        avgPnl20,
        tauPolyRem,
        tauBybitRem,
        tauEval,
      };

      if (best1  === null || avgPnl1  > best1.avgPnl1)   best1  = match;
      if (best10 === null || avgPnl10 > best10.avgPnl10)  best10 = match;
      if (best20 === null || avgPnl20 > best20.avgPnl20)  best20 = match;
    }

    results.push({ market, isUpBarrier, polyIv, best1, best10, best20 });
  }

  return results;
}
