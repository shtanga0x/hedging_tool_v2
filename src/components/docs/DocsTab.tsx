import { useState } from 'react';
import { Box, Paper, Typography, List, ListItemButton, ListItemText, Divider, Link, Stack } from '@mui/material';

type Section =
  | 'overview'
  | 'polymarket-fees'
  | 'bybit-trading-fees'
  | 'bybit-delivery-fees'
  | 'bid-ask-modes'
  | 'expiration-handling'
  | 'pnl-formula';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview',             label: 'Overview' },
  { id: 'polymarket-fees',      label: 'Polymarket fees' },
  { id: 'bybit-trading-fees',   label: 'Bybit trading fees' },
  { id: 'bybit-delivery-fees',  label: 'Bybit delivery fees' },
  { id: 'bid-ask-modes',        label: 'Bid / Mid / Ask modes' },
  { id: 'expiration-handling',  label: 'Expiration handling' },
  { id: 'pnl-formula',          label: 'P&L formula' },
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
    }}
  >{children}</Box>
);

function SectionContent({ section }: { section: Section }) {
  switch (section) {
    case 'overview':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Calculation reference</Typography>
          <Typography>
            This page documents how the position builder computes entry costs, fees,
            running P&L, and expiration payoffs. All formulas reflect what the app
            actually charges in its model — verified against Polymarket and Bybit
            official documentation.
          </Typography>
          <Typography>Source links:</Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItemText>
              · <Link href="https://docs.polymarket.com/trading/fees" target="_blank" rel="noopener">Polymarket — Trading fees</Link>
            </ListItemText>
            <ListItemText>
              · <Link href="https://help.polymarket.com/en/articles/13364478-trading-fees" target="_blank" rel="noopener">Polymarket Help Center — Trading fees</Link>
            </ListItemText>
            <ListItemText>
              · <Link href="https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained" target="_blank" rel="noopener">Bybit Help Center — Options fees explained</Link>
            </ListItemText>
            <ListItemText>
              · <Link href="https://www.bybit.com/en/help-center/article/FAQ-Options-Trading" target="_blank" rel="noopener">Bybit Help Center — Options FAQ</Link>
            </ListItemText>
          </List>
        </Stack>
      );

    case 'polymarket-fees':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Polymarket fees</Typography>
          <Typography>
            Polymarket's CLOB v2 charges a per-share <strong>taker</strong> fee that scales
            with the share price. Maker orders are not charged (and may receive rebates from
            Polymarket's Maker Rebates Program).
          </Typography>
          <Typography variant="subtitle2">Formula (per share, in USDC):</Typography>
          <Block>fee_per_share = price × feeRate × (price × (1 − price))^exponent</Block>
          <Typography>
            For the <strong>crypto</strong> category (BTC/ETH price markets), as of <Code>2026-03-30</Code> the
            parameters are <Code>feeRate = 0.072</Code> and <Code>exponent = 1</Code>, which produces
            a peak effective rate of <strong>1.80%</strong> at <Code>p = 0.50</Code> and decays
            symmetrically toward the extremes.
          </Typography>
          <Typography variant="subtitle2">Worked example:</Typography>
          <Typography>
            Buy <Code>NO ×80 @ 0.94</Code> →
          </Typography>
          <Block>fee = 80 × 0.94 × 0.072 × (0.94 × 0.06) = $0.305</Block>
          <Typography>
            Symmetry note: <Code>p × (1 − p)</Code> is identical for the YES and NO sides, so a
            $0.94 NO order pays the same fee as a $0.94 YES order in absolute dollars.
          </Typography>
          <Typography>
            See <Link href="https://docs.polymarket.com/trading/fees" target="_blank" rel="noopener">docs.polymarket.com/trading/fees</Link>.
          </Typography>
        </Stack>
      );

    case 'bybit-trading-fees':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Bybit options — trading fees (entry)</Typography>
          <Typography>
            Bybit charges a trading fee on options entry (and on close, if you close before
            expiry). The fee is the lower of two caps:
          </Typography>
          <Block>fee = min(0.03% × IndexPrice, 7% × OptionPremium) × Size</Block>
          <Typography>
            For deep-OTM legs (small premium) the <strong>7%-of-premium</strong> cap typically
            binds; for ATM/ITM legs (large premium relative to underlying) the
            <strong> 0.03%-of-index</strong> cap typically binds.
          </Typography>
          <Typography variant="subtitle2">Worked examples:</Typography>
          <Typography>
            Buy <Code>BTC-29MAY26-73000-P-USDT ×0.01 @ $460</Code> with BTC index ≈ $80,000:
          </Typography>
          <Block>min(0.0003 × 80,000, 0.07 × 460) × 0.01 = min(24, 32.2) × 0.01 = $0.24</Block>
          <Typography>
            Sell <Code>BTC-29MAY26-64000-P-USDT ×0.01 @ $55</Code>:
          </Typography>
          <Block>min(0.0003 × 80,000, 0.07 × 55) × 0.01 = min(24, 3.85) × 0.01 ≈ $0.04</Block>
          <Typography>
            See <Link href="https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained" target="_blank" rel="noopener">Bybit — Options fees explained</Link>.
          </Typography>
        </Stack>
      );

    case 'bybit-delivery-fees':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Bybit options — delivery fees (expiration)</Typography>
          <Typography>
            When an option expires <strong>in-the-money</strong> it is auto-exercised and a
            delivery (settlement) fee applies. Out-of-the-money options expire worthless
            and are <strong>not</strong> charged a delivery fee.
          </Typography>
          <Typography variant="subtitle2">Formula:</Typography>
          <Block>delivery_fee = min(0.015% × IndexPrice, 12.5% × intrinsic) × |Size|</Block>
          <Typography>
            Where <Code>intrinsic = max(S − K, 0)</Code> for calls and{' '}
            <Code>max(K − S, 0)</Code> for puts, evaluated at the settlement price (Bybit's
            estimated delivery price, calculated between 07:30–08:00 UTC on the expiry date).
          </Typography>
          <Typography>
            Both <strong>buyer and seller</strong> of an exercised option pay this fee.
          </Typography>
          <Typography variant="subtitle2">In this app:</Typography>
          <Typography>
            The "At expiry" P&L curve subtracts this fee for each ITM Bybit leg automatically.
            Earlier time snapshots ("Now", "1/3 to expiry", "2/3 to expiry") do not include
            delivery fees because they assume positions are still open.
          </Typography>
          <Typography>
            See <Link href="https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained" target="_blank" rel="noopener">Bybit — Options fees explained</Link>.
          </Typography>
        </Stack>
      );

    case 'bid-ask-modes':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Polymarket: Bid / Mid / Ask price modes</Typography>
          <Typography>
            For each Polymarket leg the position builder lets you choose which price the
            entry uses:
          </Typography>
          <List sx={{ pl: 2 }} dense>
            <ListItemText>
              <strong>Ask</strong> — assumes you cross the spread as a taker. Charges the full Polymarket taker fee.
            </ListItemText>
            <ListItemText>
              <strong>Mid</strong> — uses (bid + ask) / 2, treated as a taker for fee purposes (charged at the mid).
            </ListItemText>
            <ListItemText>
              <strong>Bid</strong> — assumes you post a maker order at the bid. Modeled as <strong>fee = 0</strong> (Polymarket does not charge maker fees).
            </ListItemText>
          </List>
          <Typography>
            The fee gating lives in <Code>PositionBuilderTab.tsx</Code>:
          </Typography>
          <Block>{`entryFee: priceMode !== 'bid'
  ? polyFeePerShare(price) × quantity
  : 0`}</Block>
          <Typography variant="h5" sx={{ mt: 2 }}>Bybit: bid / ask handling</Typography>
          <Typography>
            For Bybit option legs the entry price is taken directly from the order ticket
            (typically the ask for buys and the bid for sells). The trading-fee formula is
            applied identically regardless of side; Bybit does not currently distinguish
            maker/taker for the option products this app uses.
          </Typography>
        </Stack>
      );

    case 'expiration-handling':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">Expiration handling</Typography>
          <Typography variant="subtitle2">Polymarket binary outcomes</Typography>
          <Typography>
            At market resolution each share pays $1 if its side wins, $0 otherwise.
            The "At expiry" curve applies this binary payoff and does not deduct any
            additional fee — Polymarket does not charge a settlement/redemption fee.
          </Typography>
          <Typography variant="subtitle2">Bybit vanilla options</Typography>
          <Typography>
            At expiration (tau → 0) the Black–Scholes price collapses to intrinsic value:
            <Code>max(S − K, 0)</Code> for a call, <Code>max(K − S, 0)</Code> for a put.
            For ITM legs the app additionally subtracts the Bybit delivery fee
            (see "Bybit delivery fees"). OTM legs simply expire at zero.
          </Typography>
          <Typography variant="subtitle2">Time snapshots shown on the chart</Typography>
          <List sx={{ pl: 2 }} dense>
            <ListItemText>· <strong>Now</strong> — current time, full premium remaining</ListItemText>
            <ListItemText>· <strong>1/3 / 2/3 to expiry</strong> — partial time decay snapshots</ListItemText>
            <ListItemText>· <strong>At expiry</strong> — tau = 0; intrinsic-only payoff plus delivery fees</ListItemText>
          </List>
        </Stack>
      );

    case 'pnl-formula':
      return (
        <Stack spacing={2}>
          <Typography variant="h5">P&L formula</Typography>
          <Typography variant="subtitle2">Polymarket leg</Typography>
          <Block>{`pnl = (projectedShareValue − entryPrice) × quantity − entryFee`}</Block>
          <Typography>
            <Code>projectedShareValue</Code> at expiry is 1 (winning side) or 0 (losing side).
            Before expiry, it is the model-implied probability — Black–Scholes-derived from
            the underlying spot, smile-IV, and time remaining (for "above"/"hit" market types).
          </Typography>
          <Typography variant="subtitle2">Bybit leg</Typography>
          <Block>{`pnl = (currentBsPrice − entryPrice) × sideSign × quantity
        − entryFee
        − bybitDeliveryFee   (only at expiration, only if ITM)`}</Block>
          <Typography>
            Where <Code>sideSign = +1</Code> for buys and <Code>-1</Code> for sells.
            <Code> currentBsPrice</Code> uses the smile-interpolated IV at the leg's
            log-moneyness to avoid the flat-vol kink at the strike.
          </Typography>
          <Typography variant="subtitle2">Combined portfolio</Typography>
          <Typography>
            The chart sums Polymarket and Bybit P&Ls per spot price, plus any futures /
            spot hedge legs. The "Now" curve is anchored at current spot to ensure that
            P&L at the current price equals exactly minus the total entry fees, correcting
            for any smile-interpolation drift.
          </Typography>
        </Stack>
      );
  }
}

export function DocsTab() {
  const [active, setActive] = useState<Section>('overview');
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      <Paper elevation={1} sx={{ width: 240, flexShrink: 0, position: 'sticky', top: 64 }}>
        <Typography variant="overline" sx={{ px: 2, pt: 1.5, display: 'block', opacity: 0.7 }}>
          Documentation
        </Typography>
        <Divider sx={{ mt: 1 }} />
        <List dense disablePadding>
          {SECTIONS.map(s => (
            <ListItemButton
              key={s.id}
              selected={active === s.id}
              onClick={() => setActive(s.id)}
            >
              <ListItemText primary={s.label} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
      <Paper elevation={1} sx={{ flex: 1, p: 3, minWidth: 0 }}>
        <SectionContent section={active} />
      </Paper>
    </Box>
  );
}
