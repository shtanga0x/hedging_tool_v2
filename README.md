# position_hedger — Polymarket + Bybit Options P&L Visualizer

**Live:** [shtanga0x.github.io/position_hedger](https://shtanga0x.github.io/position_hedger/)

A browser-based portfolio tool that combines **Polymarket binary options** (crypto price events) with **Bybit vanilla options** into a single projected P&L chart. It calibrates implied volatility from live market prices, projects value across different price levels and time horizons, and renders interactive charts with dynamic % labels.

---

## What's New in V3 vs V2

| Feature | V2 | V3 |
|---------|----|----|
| Bybit vanilla options (calls/puts) | ✗ | ✓ |
| Combined Polymarket + Bybit portfolio | ✗ | ✓ |
| IV smile for Bybit option chain | ✗ | ✓ |
| Corrected normalCDF (A&S 26.2.17) | ✗ | ✓ |
| Time-snapshot labels based on actual expiry dates | ✗ | ✓ |
| Tooltip % change labels per curve | ✗ | ✓ |
| Expiry dates in UTC+1 in strike panels | ✗ | ✓ |
| H time-scaling exponent | fixed 0.50 | auto step by τ (0.70→0.50 in 10 steps) |
| Poly IV multiplier slider | ✗ | ✓ |
| Snapshot export (JPG + JSON) | ✗ | ✓ (v3.1.0) |
| Snapshot import / state restore | ✗ | ✓ (v3.1.0) |
| Adaptive X-axis ticks (ResizeObserver) | ✗ | ✓ (v3.2.0) |
| Fee-inclusive entry cost (% denominator) | ✗ | ✓ (v3.2.0) |
| Header chips: option type + Bybit expiry with time | ✗ | ✓ (v3.2.0) |
| Position block compact font (body2) | h6 | ✓ (v3.2.0) |
| Upload snapshot from Setup screen (first page) | ✗ | ✓ (v3.2.1) |
| Snapshot filename with strikes + expiry + datetime | ✗ | ✓ (v3.2.1) |
| Refresh prices button (↻) | ✗ | ✓ (v3.2.1) |

---

## How It Works

### 1. Setup Screen

Two independent data sources can be loaded simultaneously:

**Polymarket** — paste a crypto event URL (e.g. `https://polymarket.com/event/bitcoin-above-100k-feb`). The app:
- Extracts the slug and fetches event data via the Polymarket Gamma API (proxied through a Cloudflare Worker to bypass CORS)
- Auto-detects the cryptocurrency (BTC, ETH, SOL, XRP) from the series metadata
- Auto-detects option type — `"above"` (European binary) or `"hit"` (one-touch barrier)
- Parses strike prices from each market's `groupItemTitle`
- Fetches the current spot price from Binance

**Bybit** — select an expiry from the Bybit option chain. The app fetches all available calls and puts for that expiry, including mark price, bid/ask, delta, and markIv.

### 2. Strike Selection

**Polymarket** (1/3 column): select YES or NO for any strike, set quantity in contracts. Entry price = market YES price (YES side) or 1 − YES price (NO side).

**Bybit** (2/3 column): select buy or sell for any call or put at any strike, set quantity in BTC/ETH. Entry price = ask (buy) or bid (sell). Trading fees are computed and displayed.

Both sources can be used simultaneously to build a combined portfolio (e.g. long a Bybit call + short a Polymarket NO).

### 3. Pricing Engine

Full mathematical details are in [`docs/PRICING.md`](docs/PRICING.md).

**Polymarket positions** use the generalized Black-Scholes binary/barrier pricing:
- `"above"` — European binary: pays $1 if S ≥ K at expiry → priced as Φ(d₂)
- `"hit"` — One-touch barrier: pays $1 if S ever touches K → reflection-principle formula
- IV is calibrated per-strike from the live YES price using Brent's root-finding
- Time scaling uses τ^H where H is auto-computed per snapshot by time-to-expiry (see [H schedule](#h-exponent-empirical-analysis) below)
- IV smile can be uniformly scaled by the **Poly IV Multiplier** (×0.25–×4.00, default ×1.00) — see [IV Multiplier](#poly-iv-multiplier)

**Bybit positions** use standard Black-Scholes vanilla call/put pricing:
- `bsCall(S, K, σ, τ)` = S·Φ(d₁) − K·Φ(d₂)
- `bsPut(S, K, σ, τ)` = K·Φ(−d₂) − S·Φ(−d₁)
- IV is taken directly from Bybit's `markIv` field (annualized, 0–1 scale)

**Normal CDF** uses the correct Abramowitz & Stegun 26.2.17 approximation with coefficients p = 0.2316419, b₁ = 0.319381530, …, b₅ = 1.330274429. Maximum error |ε| < 7.5 × 10⁻⁸. An earlier version (pre-v3.0.1) used wrong coefficients (p = 0.3275911 from a different formula family), causing BS prices to be off by $700–$1200 near the strike and producing a visible kink/elbow in the P&L curve at the strike price — fixed in v3.0.1.

### 4. IV Smile (Sticky-Moneyness)

Both Polymarket and Bybit builds have an independent IV smile:

**Polymarket smile** — built from all market strikes at the current spot. When projecting at a different spot S', the moneyness `ln(S'/K)` is recomputed and IV is linearly interpolated from the smile (flat extrapolation at edges). This eliminates the sticky-strike artifact.

**Bybit smile** — built from the full option chain's `markIv` values. When projecting at different spot levels, the vol smile follows sticky-moneyness, producing a smooth curve instead of the kinked constant-IV shape.

### 5. Time Snapshots

The chart shows 4 snapshot curves. Labels and timestamps adapt based on which sources are active:

**Single source (Poly or Bybit only):**
- Now (Xd Yh to exp)
- 1/3 to expiry
- 2/3 to expiry
- At expiry

**Both sources active:**
- Now (time to earlier expiry shown)
- ½ to earlier expiry
- At earlier expiry ("Options" or "Event")
- At later expiry ("Options" or "Event")

### 6. P&L Formula

```
P&L(S') = Σ projectedValue_i(S') − Σ entryPrice_i

Polymarket YES:  projectedValue = priceOptionYes(S', K, IV(S',K), τ, …)
Polymarket NO:   projectedValue = 1 − priceOptionYes(…)
Bybit buy:       projectedValue = bsPrice(S', K, IV(S',K), τ, type)
Bybit sell:      projectedValue = −bsPrice(…)
```

Plus fees: `entryFee = 0.0006 × max(entryPremium, 0.1% × notional)`.

### 7. Snapshot & Data Export (v3.1.0)

**Upload button** (cyan, `⬆`) — available on both the **Setup screen** and the chart screen:
- Accepts a `.json` file saved by the camera button
- Fully restores all state: Polymarket event + markets, Bybit option chain, selections, Poly IV multiplier, price mode, spot price
- The chart renders immediately as if you had manually re-selected everything — no need to re-enter any URLs
- On the Setup screen the app navigates directly to the chart after loading

**Camera button** (green, `📷`) — appears on the chart screen when positions are selected:
- Saves `PolyHedge_{strikes}_exp{expiry}_{YYYY-MM-DD_HH-MM}.jpg` — a 2× resolution screenshot of the position summary panel, the P&L chart, and the price range slider
- Simultaneously saves `PolyHedge_{strikes}_exp{expiry}_{YYYY-MM-DD_HH-MM}.json` — a machine-readable state dump containing:
  - All Polymarket markets (question, strike, bid/ask/mid prices, endDate)
  - All Bybit option chain instruments + tickers (bid, ask, markPrice, markIv, delta, gamma, vega, theta)
  - Selected Polymarket positions (marketId, side, quantity)
  - Selected Bybit positions (symbol, side, quantity)
  - Current spot price, Poly IV multiplier, price mode (bid/mid/ask), date/time

Example filename: `PolyHedge_K95000-K100000_exp28Feb_2026-02-25_14-30.jpg`

The JSON format is versioned (`"version": "position_hedger_snapshot_v1"`) to allow future schema migrations. The `bybitChain.tickers` Map is serialized as an array and reconstructed on load.

### 8. Cost Breakdown & Margin (v3.2.0)

**Entry cost formula:**
```
Total entry cost = Σ (premium × qty) + Σ fees    (always unsigned, buy + sell alike)
```
Fees are included in the denominator so the tooltip % is consistent: a complete loss at expiry always shows −100%.

**Position display:**
- Each Bybit position shows: `{symbol} — {side} ×{qty} @ ${price} (total: ${total}, fee: ${fee} / {fee%}%)`

**Margin mode:** Bybit Portfolio Margin is used. Margin requirements are calculated at the portfolio level — long options offset short option exposure, so no separate per-position initial margin is displayed.

### 9. Chart Features

- **Adaptive X-axis ticks** — a `ResizeObserver` tracks the chart container width and targets ~11 major labeled ticks at 1100 px, scaling proportionally for other widths. Intervals are rounded to nice numbers (1, 2, 5, 10 × the nearest power of 10).
- **Green/red split lines** — positive P&L segments in green, negative in red, with bridging at sign changes
- **Combined curves** (solid→dashed) for time snapshots
- **Poly overlay** (blue) — Poly-only Now and Expiry curves when both sources are active
- **Bybit overlay** (orange) — Bybit-only Now and Expiry curves
- **Interactive legend** — click any item to toggle visibility
- **Hover tooltip** — shows P&L at hovered price for all visible curves, plus relative % change vs reference curve:
  - Snapshot curves (1/3, 2/3, Expiry): Δ% vs Now, relative to total entry cost
  - Poly Expiry: Δ% vs Poly Now
  - Bybit Expiry: Δ% vs Bybit Now
  - Now / Poly Now / Bybit Now: absolute value only (reference points, no Δ%)
- **Spot price reference line** (vertical dashed)
- **Zero P&L reference line** (horizontal dashed)
- **Price range slider** — adjusts the X-axis window
- **Poly IV Multiplier slider** — scales all calibrated Polymarket smile IVs (range ×0.25–×4.00, default ×1.00). See [IV Multiplier](#poly-iv-multiplier) for usage guidance.

### 10. Refresh Prices (v3.2.1)

A **↻ refresh button** (green, top-right) appears once a Polymarket event or Bybit chain is loaded. Clicking it re-fetches all live market data without changing the selected positions or sizes:

- **Spot price** — re-fetched from Binance
- **Polymarket prices** — re-fetched via the Cloudflare Worker proxy (fresh YES bid/ask per strike)
- **Bybit tickers** — cache cleared and re-fetched (fresh mark price, bid/ask, markIv per instrument)

The chart updates automatically with the latest prices. The button spins while the fetch is in progress.

---

## H Exponent Empirical Analysis

The `H` parameter replaces standard √τ time scaling with τ^H. For short-dated options (τ < 1 year), larger H → smaller uncertainty term → faster convergence to 0 or 1.

### Fixed H schedule (v3.3.0+)

H is fully determined by time-to-expiry — no manual override. The schedule decreases monotonically by 0.02 per additional day:

| Time to expiry | H value |
|----------------|---------|
| < 1 day        | **0.70** |
| 1 – 2 days     | **0.68** |
| 2 – 3 days     | **0.66** |
| 3 – 4 days     | **0.64** |
| 4 – 5 days     | **0.62** |
| 5 – 6 days     | **0.60** |
| 6 – 7 days     | **0.58** |
| 7 – 8 days     | **0.56** |
| 8 – 9 days     | **0.54** |
| 9 – 10 days    | **0.52** |
| ≥ 10 days      | **0.50** |

This replaces the previous 3-tier system (>7d→0.50, 3–7d→0.60, <3d→0.65) with a finer schedule that eliminates the abrupt tier-boundary jumps.

### Empirical basis

Analysis script: `scripts/analyze_h.mjs` — tests H ∈ [0.40, 0.80] across 17 Polymarket BTC events using out-of-sample prediction RMSE (calibrate IV on early half of data, predict late half).

| Group | Events | Date range |
|-------|--------|------------|
| ABOVE (daily binary, ~24h) | 12 events | Feb 13–24 2026 |
| HIT monthly (one-touch, ~30d window) | 2 events | Jan + Feb 2026 |
| HIT weekly (one-touch, 7d) | 3 events | Feb 2–8, 9–15, 16–22 2026 |

Weekly HIT events split by week-phase at τ = 3.5 days:

| Type | Phase | Tau range | Empirical H* |
|------|-------|-----------|--------------|
| HIT | Early (start of week) | 3.5 – 7 d | **0.58–0.62** |
| HIT | Late (near expiry) | 0 – 3.5 d | **0.64–0.68** |
| ABOVE | — | 0 – 1 d | **0.68–0.70** |

- Bybit vanilla options always use H = 0.50 (market convention, unchanged).
- The StdDev metric is biased toward H = 0.40; use PredRMSE for calibration.

Full mathematical details and the complete results table are in [`docs/PRICING.md`](docs/PRICING.md#time-scaling-exponent-h).

---

## Poly IV Multiplier

The Poly IV Multiplier slider (×0.25 – ×4.00, default ×1.00) scales all calibrated Polymarket implied volatilities uniformly before computing P&L curves.

### What it fixes

The pricing model calibrates IV from live Polymarket prices at the **current spot price**. When you project the curve across a range of hypothetical spot prices, the model holds those IVs frozen (sticky-moneyness). In reality, crypto implied vol changes when the spot moves — the **leverage effect** means vol rises sharply when price falls.

Concretely: if BTC drops 3% from your snapshot, the actual Polymarket prices for down-barrier strikes will be substantially higher than the model predicts, because the market has repriced with higher IV. The multiplier lets you account for this.

### Guideline

| Scenario | Suggested multiplier |
|----------|---------------------|
| Market at same spot as snapshot | ×1.00 (default) |
| BTC down ~3% from snapshot | ×1.30 – ×1.50 |
| BTC down ~5–8% from snapshot | ×1.50 – ×2.00 |
| Vol spike / fear event | ×2.00 – ×3.00 |
| Stress-test low-vol scenario | ×0.50 – ×0.75 |

The appropriate multiplier can be inferred empirically: load a snapshot, enter the current spot price, then adjust the slider until the model's "Now" curve matches the actual Polymarket prices you observe.

### What it does not fix

The multiplier shifts the entire smile uniformly. It does not model **skew changes** (one side of the smile moving more than the other) or **drift effects** (the market pricing in a directional trend). For large spot moves these second-order effects become noticeable but the multiplier captures the dominant variance.

---

## Architecture

```
src/
├── api/
│   ├── binance.ts            # Spot price from Binance API
│   ├── bybit.ts              # Bybit option chain (instruments + tickers)
│   ├── config.ts             # API base URLs
│   └── polymarket.ts         # Event fetch, slug parsing, auto-detection
├── components/
│   ├── SetupScreen.tsx        # URL input, Bybit expiry selector, snapshot upload
│   ├── BybitOptionChain.tsx   # Bybit expiry selection UI
│   ├── PolymarketPanel.tsx    # Polymarket URL/event loading UI
│   ├── ChartScreen.tsx        # Strike tables, positions summary, chart integration
│   └── ProjectionChart.tsx    # Recharts chart: split lines, legend, tooltip, dual axes
├── hooks/
│   └── usePortfolioCurves.ts  # Memoized portfolio curve computation for all snapshots
├── pricing/
│   └── engine.ts              # normalCDF (A&S 26.2.17), BS call/put, binary/barrier
│                              #   pricing, IV solver (Brent's), smile interpolation,
│                              #   combined P&L curve, Bybit fee calculation
├── types/
│   └── index.ts               # TypeScript interfaces
└── App.tsx                    # Screen routing
worker/
└── src/index.ts               # Cloudflare Worker (CORS proxy for Polymarket API)
docs/
└── PRICING.md                 # Full mathematical documentation
```

---

## Tech Stack

- **React 19** + **TypeScript** + **Vite**
- **Material UI (MUI)** — components and dark theming
- **Recharts** — charting library
- **html2canvas** — DOM-to-JPG screenshot (lazy-imported)
- **Cloudflare Workers** — CORS proxy for Polymarket API

---

## Development

```bash
npm install
npm run dev
```

Requires `VITE_WORKER_URL` environment variable pointing to the Cloudflare Worker proxy (see [`worker/README.md`](worker/README.md)).

The Bybit API is proxied through the local Vite dev server (`/api/bybit` → `https://api.bybit.com`). No additional secrets needed for Bybit.

## Deployment

Deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`. Uses Node 22, `npm ci`, `npm run build`, and the `actions/deploy-pages` action.

The app version is injected at build time from `package.json` via Vite's `define` and displayed as a small version tag at the bottom of both screens.
