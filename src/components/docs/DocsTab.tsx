import { useState } from 'react';
import { Box, Paper, Typography, List, ListItemButton, ListItemText, Divider, Link, Stack } from '@mui/material';

type Section =
  | 'overview'
  | 'polymarket-fees'
  | 'bybit-fees'
  | 'builder'
  | 'finder'
  | 'backtester';

interface SidebarGroup {
  title: string;
  items: { id: Section; label: string }[];
}

const SIDEBAR: SidebarGroup[] = [
  {
    title: 'Start',
    items: [{ id: 'overview', label: 'Overview' }],
  },
  {
    title: 'Reference — fees',
    items: [
      { id: 'polymarket-fees', label: 'Polymarket fees' },
      { id: 'bybit-fees',      label: 'Bybit options fees' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'builder',    label: 'Position Builder' },
      { id: 'finder',     label: 'Position Finder' },
      { id: 'backtester', label: 'Backtester' },
    ],
  },
];

const Code = ({ children }: { children: React.ReactNode }) => (
  <Box
    component="code"
    sx={{
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      px: 0.75, py: 0.25, borderRadius: 0.5,
      bgcolor: 'action.hover', fontSize: '0.875em',
    }}
  >{children}</Box>
);

const Block = ({ children }: { children: React.ReactNode }) => (
  <Box
    component="pre"
    sx={{
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      p: 1.5, borderRadius: 1, bgcolor: 'action.hover',
      fontSize: '0.85em', overflowX: 'auto', m: 0, my: 1,
      whiteSpace: 'pre-wrap',
    }}
  >{children}</Box>
);

const SubHeader = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2 }}>{children}</Typography>
);

function SectionContent({ section }: { section: Section }) {
  switch (section) {
    case 'overview':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Calculation reference</Typography>
          <Typography>
            This documentation explains how the app prices, charges fees, and projects
            P&L for every leg type. It is split into two parts:
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · <strong>Reference — fees</strong>: standalone fee specifications (Polymarket, Bybit) that apply across every tool.
            </ListItemText>
            <ListItemText>
              · <strong>Tools</strong>: behavior, controls, fee accounting, and caveats specific to each tab — Position Builder, Position Finder, Backtester.
            </ListItemText>
          </List>
          <Typography>
            All formulas reflect what the app actually computes. They were verified against live
            fees charged on real positions and against vendor documentation linked below.
          </Typography>
          <SubHeader>Primary sources</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· <Link href="https://docs.polymarket.com/trading/fees" target="_blank" rel="noopener">Polymarket developer docs — Trading fees</Link></ListItemText>
            <ListItemText>· <Link href="https://help.polymarket.com/en/articles/13364478-trading-fees" target="_blank" rel="noopener">Polymarket Help Center — Trading fees</Link></ListItemText>
            <ListItemText>· <Link href="https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained" target="_blank" rel="noopener">Bybit Help Center — Options fees explained</Link></ListItemText>
            <ListItemText>· <Link href="https://www.bybit.com/en/help-center/article/FAQ-Options-Trading" target="_blank" rel="noopener">Bybit Help Center — Options FAQ</Link></ListItemText>
          </List>
        </Stack>
      );

    case 'polymarket-fees':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Polymarket fees</Typography>
          <Typography>
            Polymarket's CLOB v2 charges a per-share <strong>taker</strong> fee. Maker orders
            (resting on the book at the bid) are not charged and may receive rebates from
            Polymarket's Maker Rebates Program. There is <strong>no settlement / redemption fee</strong>{' '}
            at market resolution.
          </Typography>

          <SubHeader>Fee formula (per share, USDC)</SubHeader>
          <Block>fee_per_share = price × feeRate × (price × (1 − price))^exponent</Block>
          <Typography>
            For the <strong>crypto</strong> category (BTC/ETH price markets), as of <Code>2026-03-30</Code> the
            parameters are <Code>feeRate = 0.072</Code> and <Code>exponent = 1</Code>. This produces a
            peak effective rate of <strong>1.80%</strong> at <Code>p = 0.50</Code>, decaying symmetrically
            toward the extremes (a 5¢ market pays almost nothing, a 50¢ market pays the most).
          </Typography>
          <Typography>
            Symmetry note: <Code>p × (1 − p)</Code> is identical for the YES and NO sides, so a $0.94
            NO order and a $0.94 YES order pay the same dollar fee.
          </Typography>

          <SubHeader>Worked example</SubHeader>
          <Typography>Buy <Code>NO ×80 @ 0.94</Code>:</Typography>
          <Block>fee = 80 × 0.94 × 0.072 × (0.94 × 0.06) = $0.305</Block>

          <SubHeader>Other categories</SubHeader>
          <Typography>
            Polymarket uses different rates per market category (e.g. Politics 1.00%, Sports 0.75%,
            Geopolitical 0%). This app currently focuses on crypto markets and uses the crypto rate
            globally for Polymarket legs.
          </Typography>

          <SubHeader>Implementation</SubHeader>
          <Typography>
            <Code>polyFeePerShare(price)</Code> in <Code>src/pricing/engine.ts</Code> implements the
            formula. Fee gating by side (taker vs maker / bid) is documented under{' '}
            <em>Position Builder → Bid / Mid / Ask modes</em>.
          </Typography>
          <Typography>
            See <Link href="https://docs.polymarket.com/trading/fees" target="_blank" rel="noopener">docs.polymarket.com/trading/fees</Link>.
          </Typography>
        </Stack>
      );

    case 'bybit-fees':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Bybit options fees</Typography>
          <Typography>
            Bybit charges two distinct fees on options: a <strong>trading fee</strong> on every
            opening / closing trade, and a <strong>delivery fee</strong> on options that are
            auto-exercised at expiration (ITM only).
          </Typography>

          <SubHeader>1. Trading fee (entry / close)</SubHeader>
          <Block>fee = min(0.03% × IndexPrice, 7% × OptionPremium) × Size</Block>
          <Typography>
            Two caps; whichever is lower binds:
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · For deep-OTM legs (small premium) the <strong>7%-of-premium</strong> cap binds — the
              fee scales with the cheap option price.
            </ListItemText>
            <ListItemText>
              · For ATM / ITM legs (large premium relative to underlying) the{' '}
              <strong>0.03%-of-index</strong> cap binds — the fee is a flat fraction of the underlying.
            </ListItemText>
          </List>
          <Typography>
            The same formula applies regardless of buy vs sell. Bybit does not currently differentiate
            maker/taker for the USDT options used in this app.
          </Typography>

          <SubHeader>Worked examples</SubHeader>
          <Typography>Buy <Code>BTC-29MAY26-73000-P-USDT ×0.01 @ $460</Code>, BTC index ≈ $80,000:</Typography>
          <Block>min(0.0003 × 80,000, 0.07 × 460) × 0.01 = min(24, 32.2) × 0.01 = $0.24</Block>
          <Typography>Sell <Code>BTC-29MAY26-64000-P-USDT ×0.01 @ $55</Code>:</Typography>
          <Block>min(0.0003 × 80,000, 0.07 × 55) × 0.01 = min(24, 3.85) × 0.01 ≈ $0.04</Block>

          <SubHeader>2. Delivery fee (expiration)</SubHeader>
          <Typography>
            Charged only on options that finish <strong>in-the-money</strong> and are auto-exercised.
            Out-of-the-money options expire worthless with <strong>no</strong> delivery fee.
            Both buyer and seller of an exercised option pay this fee.
          </Typography>
          <Block>delivery_fee = min(0.015% × IndexPrice, 12.5% × intrinsic) × |Size|</Block>
          <Typography>
            Where <Code>intrinsic = max(S − K, 0)</Code> for calls and <Code>max(K − S, 0)</Code>{' '}
            for puts, evaluated at the settlement (estimated delivery) price. Bybit calculates the
            settlement price between 07:30–08:00 UTC on the expiry date from the BTC spot index.
          </Typography>

          <SubHeader>Implementation</SubHeader>
          <Typography>
            <Code>bybitTradingFee(...)</Code> and <Code>bybitDeliveryFee(...)</Code> in{' '}
            <Code>src/pricing/engine.ts</Code>. Where each is applied per tool is documented in the
            Tools sections.
          </Typography>
          <Typography>
            See <Link href="https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained" target="_blank" rel="noopener">Bybit — Options fees explained</Link>.
          </Typography>
        </Stack>
      );

    case 'builder':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Position Builder</Typography>
          <Typography>
            Manually compose a multi-leg position from Polymarket binary outcomes, Bybit options,
            and futures / spot. The chart shows portfolio P&L across a price range at multiple time
            snapshots, including the "At expiry" payoff.
          </Typography>

          <SubHeader>Bid / Mid / Ask price modes (Polymarket)</SubHeader>
          <Typography>
            Each Polymarket card has a price-mode selector that controls both the entry price used
            and whether a fee is charged:
          </Typography>
          <List sx={{ pl: 2 }} dense>
            <ListItemText>
              <strong>Ask</strong> — assumes you cross the spread as a taker. Entry = best ask.
              Polymarket taker fee charged.
            </ListItemText>
            <ListItemText>
              <strong>Mid</strong> — entry = (bid + ask) / 2. Treated as a taker for fee purposes
              (charged at the mid).
            </ListItemText>
            <ListItemText>
              <strong>Bid</strong> — assumes you post a maker order at the bid. Entry = best bid.
              Modeled as <strong>fee = 0</strong> (Polymarket does not charge maker fees).
            </ListItemText>
          </List>
          <Typography>
            For NO contracts the prices are flipped: NO ask = 1 − YES bid; NO bid = 1 − YES ask;
            NO mid = 1 − YES mid.
          </Typography>
          <Block>{`entryFee: priceMode !== 'bid'
  ? polyFeePerShare(entryPrice) × quantity
  : 0`}</Block>

          <SubHeader>Bybit fee handling in the builder</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · <strong>Entry</strong>: trading fee applied per leg using current spot as IndexPrice.
            </ListItemText>
            <ListItemText>
              · <strong>"At expiry" curve only</strong>: subtracts <Code>bybitDeliveryFee</Code> on the
              ITM half of the curve. OTM half is unchanged. Earlier snapshots ("Now", "1/3", "2/3 to expiry")
              do <em>not</em> include delivery fees because they assume positions are still open.
            </ListItemText>
          </List>

          <SubHeader>Time snapshots on the chart</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· <strong>Now</strong> — current time, full premium remaining.</ListItemText>
            <ListItemText>· <strong>1/3 to expiry</strong>, <strong>2/3 to expiry</strong> — partial time-decay snapshots.</ListItemText>
            <ListItemText>· <strong>At expiry</strong> — tau = 0; intrinsic-only payoff plus Bybit delivery fees on ITM legs.</ListItemText>
            <ListItemText>· <strong>At Bybit expiry</strong> (when Bybit expires before Polymarket) — Polymarket value at the time Bybit settles.</ListItemText>
          </List>
          <Typography>
            The <strong>Now</strong> curve is anchored at current spot so that PnL at the current
            price equals exactly minus total entry fees, correcting for smile-interpolation drift.
          </Typography>

          <SubHeader>P&L formula per leg</SubHeader>
          <Typography variant="subtitle2">Polymarket leg</Typography>
          <Block>pnl = (projectedShareValue − entryPrice) × quantity − entryFee</Block>
          <Typography>
            <Code>projectedShareValue</Code> at expiry is 1 (winning side) or 0 (losing side).
            Before expiry it is the model-implied probability — Black–Scholes-derived from the
            underlying spot, smile-IV, and time remaining (for "above" / "hit" market types,
            with the "hit" type using the barrier <Code>H</Code> from the auto-step function).
          </Typography>
          <Typography variant="subtitle2">Bybit leg</Typography>
          <Block>{`pnl = (currentBsPrice − entryPrice) × sideSign × quantity
        − entryFee
        − bybitDeliveryFee   // only at expiration & only if ITM`}</Block>
          <Typography>
            <Code>sideSign = +1</Code> for buys, <Code>−1</Code> for sells.{' '}
            <Code>currentBsPrice</Code> uses smile-interpolated IV at the leg's log-moneyness.
          </Typography>
          <Typography variant="subtitle2">Futures / spot leg</Typography>
          <Block>pnl = (cryptoPrice − entryPrice) × size      // size signed: + long, − short</Block>
          <Typography>No fees modeled for the futures / spot hedge.</Typography>

          <SubHeader>Other unique controls</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· <strong>Price range slider</strong> — adjusts chart X-axis around current spot.</ListItemText>
            <ListItemText>· <strong>Inverse</strong> — flips every leg (YES↔NO, buy↔sell, long↔short).</ListItemText>
            <ListItemText>· <strong>Refresh</strong> — re-fetches spot, Polymarket quotes, IV; recomputes fees.</ListItemText>
            <ListItemText>· <strong>Save / Load snapshot</strong> — preserves spotPrice and priceRange too.</ListItemText>
          </List>
        </Stack>
      );

    case 'finder':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Position Finder</Typography>
          <Typography>
            Searches a Polymarket event and pairs each strike with the Bybit option chain to find
            <strong> 3-leg hedge candidates</strong> (long Bybit option + short Bybit option +
            sized Polymarket binary) that achieve a non-negative combined P&L across a price band
            around current spot.
          </Typography>

          <SubHeader>Inputs</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Polymarket event search (text or JSON upload).</ListItemText>
            <ListItemText>· Bybit option expiry dropdown (filtered to expiries ≤ Polymarket expiry).</ListItemText>
            <ListItemText>· Option size in BTC (default 0.01).</ListItemText>
            <ListItemText>· Spot price (auto-fetched from Binance, manually overridable).</ListItemText>
            <ListItemText>· <strong>Run</strong> — triggers optimization across all Poly strikes.</ListItemText>
          </List>

          <SubHeader>Optimization criterion</SubHeader>
          <Typography>
            For each Polymarket strike <Code>K</Code> the optimizer:
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              1. Pins the Bybit short leg to the nearest available strike to <Code>K</Code>.
            </ListItemText>
            <ListItemText>
              2. Sweeps Bybit long-leg strikes; sizes the Polymarket leg so that the combined P&L
              equals zero <strong>at K</strong> (NO side) or at the ±20% boundary (YES side).
            </ListItemText>
            <ListItemText>
              3. <strong>Feasibility check</strong>: combined P&L ≥ 0 across the full ±20% range —
              candidates with any negative excursion are rejected.
            </ListItemText>
            <ListItemText>
              4. <strong>Scoring</strong>: ranks surviving candidates by average P&L across ±10%,
              with ±1% and ±20% averages also reported in the table.
            </ListItemText>
          </List>
          <Typography>
            Both Polymarket option types are supported: <strong>"above"</strong> (binary step at K)
            and <strong>"hit"</strong> (one-touch barrier; uses the auto-H step function).
          </Typography>

          <SubHeader>Outputs</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Results table: one row per Poly strike with the best Bybit pairing and three avg-PnL bands.</ListItemText>
            <ListItemText>· Selected-row chart: Polymarket payoff, Bybit spread, combined P&L, IV smile, Greeks overlays.</ListItemText>
            <ListItemText>· <strong>Send to Builder</strong> — transfers the selected candidate as editable cards in the Position Builder.</ListItemText>
            <ListItemText>· <strong>Save</strong> — exports JSON snapshot + chart PNG.</ListItemText>
          </List>

          <SubHeader>Fee accounting in the Finder</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · <strong>Polymarket entry fee</strong>: subtracted from each candidate using{' '}
              <Code>polyFeePerShare()</Code>. Bid orders are zero-fee.
            </ListItemText>
            <ListItemText>
              · <strong>Bybit trading fee</strong>: applied to both the long and short Bybit legs at
              their entry premiums via <Code>bybitTradingFee(spot, premium, qty)</Code>.
            </ListItemText>
            <ListItemText>
              · <strong>Bybit delivery fee</strong>: <em>not</em> modeled in the optimizer. The Finder
              optimizes the pre-expiry P&L surface; if a candidate finishes ITM, the buyer/seller
              would each owe additional delivery fees. Use the Position Builder's "At expiry" curve
              to inspect that.
            </ListItemText>
          </List>

          <SubHeader>Caveats</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · No slippage. Uses live Bybit ask (for buys) / bid (for sells) and Polymarket bid/ask
              directly — actual fills may differ.
            </ListItemText>
            <ListItemText>
              · Per-leg tau is truncated to <Code>min(polyTau, bybitTau)</Code>; expiries shorter than
              the Polymarket event are not evaluated for the combined payoff.
            </ListItemText>
            <ListItemText>
              · IV is solved by inverting the Polymarket mid-price using BS + auto-H, then propagated
              to the Bybit smile interpolation — assumes consistent vol across venues.
            </ListItemText>
            <ListItemText>· Results are theoretical; treat as a screening tool, not an order-router.</ListItemText>
          </List>
        </Stack>
      );

    case 'backtester':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Backtester</Typography>
          <Typography>
            Replays historical prices to compute per-position P&L series for Polymarket binaries,
            Bybit / Deribit options, and futures / spot legs. Useful for sanity-checking what a
            given Position Builder configuration would have done over a past window.
          </Typography>

          <SubHeader>Inputs</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Add cards via the floating + button (Polymarket / Deribit option / Bybit option / futures).</ListItemText>
            <ListItemText>· Date range (default: last 90 days → today).</ListItemText>
            <ListItemText>· <strong>Run Backtest</strong> — fetches all data and computes series.</ListItemText>
            <ListItemText>· <strong>Refresh</strong> — re-fetches with end-date pinned to <em>now</em> (handy on stale tabs).</ListItemText>
            <ListItemText>· Crypto overlay toggle (BTC / ETH) with candle interval (1h / 5m / 15m).</ListItemText>
          </List>

          <SubHeader>Data sources by leg type</SubHeader>
          <Typography variant="subtitle2">Polymarket</Typography>
          <Typography>
            1-minute tick history from the Polymarket API. Entry price = first non-zero price in the
            window (so the P&L series starts at $0). P&L = <Code>(price_t − entryPrice) × qty − entryFee</Code>.
          </Typography>
          <Typography variant="subtitle2">Deribit options</Typography>
          <Typography>
            Primary: Deribit TradingView candles (mark price, BTC-denominated) converted to USD via Binance BTC/USD spot.
            Fallback chain when a strike is illiquid:
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Probe the last 30 days if the full range comes back empty.</ListItemText>
            <ListItemText>· Substitute the nearest strike of the same type / expiry.</ListItemText>
            <ListItemText>· Last resort: synthesize hourly candles from individual trade records.</ListItemText>
          </List>
          <Typography>Warnings are emitted in the UI if exact-strike data was missing or rate-limited.</Typography>
          <Typography variant="subtitle2">Bybit options (local library)</Typography>
          <Typography>
            Loads from a local <Code>btc-options-lib</Code> Parquet library: midprice history at
            5min–1h resolution depending on backtest length. Already in USDT, no BTC conversion.
          </Typography>
          <Typography variant="subtitle2">Bybit options (BS reconstruction)</Typography>
          <Typography>
            For strikes not in the local library, the series is reconstructed from{' '}
            <Code>bsPrice(S, K, σ, τ)</Code> with time-varying IV. IV priority:
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>1. Inverted from a Deribit nearby-strike price (<Code>bsImpliedVol</Code>).</ListItemText>
            <ListItemText>2. Deribit DVOL (ATM proxy) bucketed hourly.</ListItemText>
            <ListItemText>3. Manually entered Entry IV.</ListItemText>
          </List>
          <Typography>
            The final hour before expiry is skipped to avoid the vega ≈ 0 instability that produces
            spurious price swings.
          </Typography>
          <Typography variant="subtitle2">Futures / spot</Typography>
          <Typography>
            Binance hourly OHLC. Entry = first candle close. <Code>P&L = (spot − entry) × size</Code>
            (size signed: + long, − short).
          </Typography>

          <SubHeader>Fee accounting in the Backtester</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · <strong>Polymarket entry fee</strong>: applied per leg (zero in bid mode), included
              in the per-position cost basis used for % P&L.
            </ListItemText>
            <ListItemText>
              · <strong>Bybit / Deribit trading fee</strong>: <em>not</em> currently modeled in
              backtest series — premium evolution alone drives the curves.
            </ListItemText>
            <ListItemText>
              · <strong>Bybit delivery fee</strong>: <em>not</em> modeled in backtest projections.
            </ListItemText>
            <ListItemText>
              · <strong>Futures / spot</strong>: no fees modeled.
            </ListItemText>
          </List>
          <Typography sx={{ opacity: 0.85 }}>
            Treat backtest P&L as <strong>pre-fee gross</strong> for option / futures legs and
            apply the fee specs from the Reference sections to estimate net P&L.
          </Typography>

          <SubHeader>Outputs</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Multi-position line chart: per-leg P&L (color-coded) and Total P&L (always pinned to the bottom of legend / tooltip).</ListItemText>
            <ListItemText>· Optional crypto candlestick overlay.</ListItemText>
            <ListItemText>· Per-position summary cards: entry price, qty, fee, current P&L.</ListItemText>
          </List>

          <SubHeader>Caveats</SubHeader>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>· Polymarket series start at the first non-zero print — early market history may be missing.</ListItemText>
            <ListItemText>· Deribit fallbacks introduce gaps or use proxy strikes; check the warnings panel.</ListItemText>
            <ListItemText>· DVOL is hourly-bucketed; sparse periods are interpolated to the nearest bucket.</ListItemText>
            <ListItemText>· No slippage, no funding, no settlement fees — only premium / spot evolution.</ListItemText>
          </List>
        </Stack>
      );
  }
}

export function DocsTab() {
  const [active, setActive] = useState<Section>('overview');
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      <Paper elevation={1} sx={{ width: 260, flexShrink: 0, position: 'sticky', top: 64, py: 1 }}>
        {SIDEBAR.map((group, i) => (
          <Box key={group.title}>
            {i > 0 && <Divider sx={{ my: 0.5 }} />}
            <Typography
              variant="overline"
              sx={{ px: 2, pt: 1, display: 'block', opacity: 0.6, letterSpacing: '0.06em' }}
            >
              {group.title}
            </Typography>
            <List dense disablePadding>
              {group.items.map(item => (
                <ListItemButton
                  key={item.id}
                  selected={active === item.id}
                  onClick={() => setActive(item.id)}
                >
                  <ListItemText primary={item.label} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))}
      </Paper>
      <Paper elevation={1} sx={{ flex: 1, p: 3, minWidth: 0 }}>
        <SectionContent section={active} />
      </Paper>
    </Box>
  );
}
