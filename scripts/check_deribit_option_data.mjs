/**
 * Script to check Deribit option data availability for BTC-29MAR26 expiry.
 * 
 * Goals:
 * 1. List expired instruments for 29MAR26 to find correct Deribit naming
 * 2. Fetch historical candle data for BTC-29MAR26-72000-C
 * 3. Compare with Bybit data availability
 */

const DERIBIT_BASE = 'https://www.deribit.com';

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

// 1. Check expired instruments for 29MAR26
async function checkExpiredInstruments() {
  console.log('=== 1. Fetching EXPIRED BTC option instruments from Deribit ===\n');
  const data = await fetchJSON(
    `${DERIBIT_BASE}/api/v2/public/get_instruments?currency=BTC&kind=option&expired=true`
  );
  const instruments = data.result || [];
  console.log(`Total expired BTC options: ${instruments.length}`);

  // Filter for 29MAR26
  const mar29 = instruments.filter(i => i.instrument_name.includes('29MAR26'));
  console.log(`29MAR26 expired instruments found: ${mar29.length}`);

  if (mar29.length > 0) {
    // Show first 10 and any near 72000 strike
    console.log('\nFirst 10 instruments:');
    mar29.slice(0, 10).forEach(i => console.log(`  ${i.instrument_name}  strike=${i.strike}`));

    const near72k = mar29.filter(i => Math.abs(i.strike - 72000) <= 5000);
    console.log(`\nInstruments near 72000 strike (±5000):`);
    near72k.forEach(i => console.log(`  ${i.instrument_name}  strike=${i.strike}`));

    // Check exact 72000
    const exact = mar29.find(i => i.strike === 72000 && i.instrument_name.endsWith('-C'));
    if (exact) {
      console.log(`\n✅ EXACT MATCH: ${exact.instrument_name}`);
      console.log(`   Full details:`, JSON.stringify(exact, null, 2));
    } else {
      console.log(`\n❌ No exact 72000 Call found. Available strikes:`);
      const callStrikes = mar29
        .filter(i => i.instrument_name.endsWith('-C'))
        .map(i => i.strike)
        .sort((a, b) => a - b);
      console.log(`   ${callStrikes.join(', ')}`);
    }
  }

  return mar29;
}

// 2. Also check active (non-expired) instruments
async function checkActiveInstruments() {
  console.log('\n=== 2. Fetching ACTIVE BTC option instruments from Deribit ===\n');
  const data = await fetchJSON(
    `${DERIBIT_BASE}/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false`
  );
  const instruments = data.result || [];
  const mar29 = instruments.filter(i => i.instrument_name.includes('29MAR26'));
  console.log(`Active 29MAR26 instruments: ${mar29.length}`);
  if (mar29.length > 0) {
    mar29.slice(0, 5).forEach(i => console.log(`  ${i.instrument_name}  strike=${i.strike}`));
  }
  return mar29;
}

// 3. Try fetching historical candle data
async function checkCandleData(instrumentName) {
  console.log(`\n=== 3. Fetching candle data for ${instrumentName} ===\n`);

  // Try last 7 days of data (around expiration on 29 Mar 2026)
  const endMs = Date.now();
  const startMs = endMs - 7 * 24 * 60 * 60 * 1000; // 7 days back

  try {
    const data = await fetchJSON(
      `${DERIBIT_BASE}/api/v2/public/get_tradingview_chart_data?` +
      `instrument_name=${instrumentName}&start_timestamp=${startMs}&end_timestamp=${endMs}&resolution=60`
    );
    const result = data.result;
    if (result && result.ticks && result.status !== 'no_data') {
      console.log(`✅ Got ${result.ticks.length} candles!`);
      console.log(`   Time range: ${new Date(result.ticks[0]).toISOString()} → ${new Date(result.ticks[result.ticks.length - 1]).toISOString()}`);
      console.log(`   Last close: ${result.close[result.close.length - 1]}`);
      console.log(`   Sample (last 3):`);
      for (let i = Math.max(0, result.ticks.length - 3); i < result.ticks.length; i++) {
        console.log(`     ${new Date(result.ticks[i]).toISOString()}  O=${result.open[i]} H=${result.high[i]} L=${result.low[i]} C=${result.close[i]}`);
      }
    } else {
      console.log(`❌ No candle data returned (status: ${result?.status})`);
    }
  } catch (err) {
    console.log(`❌ Error fetching candles: ${err.message}`);
  }

  // Also try a wider range - 30 days back
  console.log(`\n   Trying 30-day range...`);
  const startMs30 = endMs - 30 * 24 * 60 * 60 * 1000;
  try {
    const data = await fetchJSON(
      `${DERIBIT_BASE}/api/v2/public/get_tradingview_chart_data?` +
      `instrument_name=${instrumentName}&start_timestamp=${startMs30}&end_timestamp=${endMs}&resolution=60`
    );
    const result = data.result;
    if (result && result.ticks && result.status !== 'no_data') {
      console.log(`✅ Got ${result.ticks.length} candles (30-day range)!`);
      console.log(`   Time range: ${new Date(result.ticks[0]).toISOString()} → ${new Date(result.ticks[result.ticks.length - 1]).toISOString()}`);
    } else {
      console.log(`❌ No data for 30-day range (status: ${result?.status})`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

// 4. Also try Bybit mark-price kline for comparison
async function checkBybitData(symbol) {
  console.log(`\n=== 4. Checking Bybit mark-price candles for ${symbol} ===\n`);
  const endMs = Date.now();
  const startMs = endMs - 7 * 24 * 60 * 60 * 1000;

  try {
    const data = await fetchJSON(
      `https://api.bybit.com/v5/market/mark-price-kline?` +
      `category=option&symbol=${symbol}&interval=60&start=${startMs}&end=${endMs}&limit=200`
    );
    const list = data.result?.list || [];
    console.log(`Got ${list.length} candles from Bybit`);
    if (list.length > 0) {
      console.log(`   Newest: ${new Date(parseInt(list[0][0])).toISOString()}`);
      console.log(`   Oldest: ${new Date(parseInt(list[list.length - 1][0])).toISOString()}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function main() {
  console.log('Deribit & Bybit Option Data Check - BTC-29MAR26-72000-C');
  console.log('Today:', new Date().toISOString());
  console.log('=' .repeat(60));

  const expiredInstruments = await checkExpiredInstruments();
  await checkActiveInstruments();

  // Try the standard Deribit name format (same as Bybit minus USDT suffix)
  await checkCandleData('BTC-29MAR26-72000-C');

  // If 72000 doesn't exist, try closest strike from expired list
  if (expiredInstruments.length > 0) {
    const calls = expiredInstruments
      .filter(i => i.instrument_name.endsWith('-C'))
      .sort((a, b) => Math.abs(a.strike - 72000) - Math.abs(b.strike - 72000));
    if (calls.length > 0 && calls[0].strike !== 72000) {
      console.log(`\n--- Trying closest Deribit strike: ${calls[0].instrument_name} ---`);
      await checkCandleData(calls[0].instrument_name);
    }
  }

  // Check Bybit for comparison
  await checkBybitData('BTC-29MAR26-72000-C-USDT');

  console.log('\n' + '='.repeat(60));
  console.log('Done.');
}

main().catch(console.error);
