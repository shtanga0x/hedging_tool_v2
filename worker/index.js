/**
 * Cloudflare Worker — proxy for Polymarket, Binance, Bybit, Deribit
 *
 * Routes:
 *   /api/gamma/*   -> https://gamma-api.polymarket.com/*
 *   /api/clob/*    -> https://clob.polymarket.com/*
 *   /api/bybit/*   -> https://api.bybit.com/*
 *   /api/deribit/* -> https://www.deribit.com/*
 *
 * Deribit 429 handling: retries via HTTP-CONNECT proxy rotation.
 * Successful Deribit responses are cached (instruments 5 min, candles 2 min).
 */

import { connect } from 'cloudflare:sockets';

// ─── Rotating residential proxies (IP:PORT:USER:PASS) ─────────────────────────
const PROXIES = [
  { host: '163.5.176.78',    port: 45148, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '185.191.22.217',  port: 45428, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '185.191.23.150',  port: 45802, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '45.10.158.249',   port: 48376, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '45.10.159.179',   port: 48742, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '45.40.122.62',    port: 45618, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.0.39',     port: 46082, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.1.157',    port: 46826, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.10.220',   port: 48464, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.11.42',    port: 48616, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '84.32.178.25',    port: 47064, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '84.32.179.109',   port: 47740, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '87.120.192.179',  port: 47170, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '87.120.193.156',  port: 47630, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '87.121.62.200',   port: 51428, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '87.121.63.20',    port: 51647, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '89.213.254.177',  port: 46350, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '89.213.255.167',  port: 46836, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.10.200',   port: 48424, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.0.235',    port: 46474, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '84.32.179.100',   port: 47722, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '84.32.179.39',    port: 47600, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '82.206.0.249',    port: 46502, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '185.191.22.61',   port: 45116, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
  { host: '185.191.23.82',   port: 45666, user: 'WEH8NZ9C', pass: 'MMUGE89K' },
];

let proxyIdx = 0;
function nextProxy() {
  const p = PROXIES[proxyIdx % PROXIES.length];
  proxyIdx++;
  return p;
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const ROUTES = {
  '/api/gamma':   'https://gamma-api.polymarket.com',
  '/api/clob':    'https://clob.polymarket.com',
  '/api/bybit':   'https://api.bybit.com',
  '/api/deribit': 'https://www.deribit.com',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function handleOptions(request) {
  const h = request.headers;
  if (h.get('Origin') && h.get('Access-Control-Request-Method')) {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(null, { headers: { Allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
}

/** Decode HTTP/1.1 chunked transfer encoding. */
function decodeChunked(body) {
  let result = '';
  let pos = 0;
  while (pos < body.length) {
    const crlfIdx = body.indexOf('\r\n', pos);
    if (crlfIdx === -1) break;
    const sizeStr = body.slice(pos, crlfIdx).split(';')[0].trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;
    pos = crlfIdx + 2;
    result += body.slice(pos, pos + chunkSize);
    pos += chunkSize + 2; // skip trailing \r\n after chunk data
  }
  return result;
}

/**
 * Fetch a URL through an HTTP CONNECT proxy using cloudflare:sockets.
 * Works for HTTPS targets; does the full CONNECT handshake + TLS upgrade.
 */
async function fetchViaProxy(targetUrlStr) {
  const proxy = nextProxy();
  const url = new URL(targetUrlStr);
  const targetHost = url.hostname;
  const targetPort = 443;

  const socket = connect({ hostname: proxy.host, port: proxy.port });

  try {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // ── 1. Send HTTP CONNECT ──────────────────────────────────────────────────
    const auth = btoa(`${proxy.user}:${proxy.pass}`);
    const connectMsg =
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n` +
      `Proxy-Authorization: Basic ${auth}\r\n` +
      `\r\n`;
    await writer.write(new TextEncoder().encode(connectMsg));
    writer.releaseLock();

    // ── 2. Read CONNECT response ──────────────────────────────────────────────
    const dec = new TextDecoder();
    let connectResp = '';
    while (!connectResp.includes('\r\n\r\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Proxy closed connection during CONNECT handshake');
      connectResp += dec.decode(value, { stream: true });
    }
    reader.releaseLock();

    const connectStatusLine = connectResp.split('\r\n')[0];
    const connectStatus = parseInt(connectStatusLine.split(' ')[1]);
    if (connectStatus !== 200) {
      throw new Error(`Proxy CONNECT rejected (${connectStatus}): ${connectStatusLine}`);
    }

    // ── 3. Upgrade to TLS ─────────────────────────────────────────────────────
    const tlsSocket = socket.startTls({ expectedServerHostname: targetHost });
    const tlsWriter = tlsSocket.writable.getWriter();
    const tlsReader = tlsSocket.readable.getReader();

    // ── 4. Send HTTP/1.1 GET request ─────────────────────────────────────────
    const reqPath = url.pathname + url.search;
    const httpReq =
      `GET ${reqPath} HTTP/1.1\r\n` +
      `Host: ${targetHost}\r\n` +
      `Connection: close\r\n` +
      `Accept: application/json\r\n` +
      `\r\n`;
    await tlsWriter.write(new TextEncoder().encode(httpReq));
    tlsWriter.releaseLock();

    // ── 5. Read full HTTP response (connection close = end of body) ───────────
    const chunks = [];
    while (true) {
      const { value, done } = await tlsReader.read();
      if (done) break;
      chunks.push(value);
    }
    tlsReader.releaseLock();

    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const buf = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }

    const fullText = new TextDecoder().decode(buf);
    const headerEnd = fullText.indexOf('\r\n\r\n');
    if (headerEnd === -1) throw new Error('Malformed HTTP response from proxy target');

    const headerSection = fullText.slice(0, headerEnd);
    let body = fullText.slice(headerEnd + 4);

    const respStatusLine = headerSection.split('\r\n')[0];
    const respStatus = parseInt(respStatusLine.split(' ')[1]) || 500;

    // Decode chunked transfer encoding if needed
    if (headerSection.toLowerCase().includes('transfer-encoding: chunked')) {
      body = decodeChunked(body);
    }

    const respHeaders = new Headers(corsHeaders);
    respHeaders.set('Content-Type', 'application/json');
    return new Response(body, { status: respStatus, headers: respHeaders });

  } finally {
    try { socket.close(); } catch { /* ignore */ }
  }
}

// ─── Main request handler ────────────────────────────────────────────────────
async function handleRequest(request, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Route matching
  let targetBase = null;
  let prefix = null;
  for (const [routePrefix, target] of Object.entries(ROUTES)) {
    if (pathname.startsWith(routePrefix)) {
      targetBase = target;
      prefix = routePrefix;
      break;
    }
  }

  if (!targetBase) {
    return new Response(JSON.stringify({ error: 'Not found', path: pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const targetPath = pathname.replace(prefix, '') || '/';
  const targetUrl = new URL(targetPath, targetBase);
  targetUrl.search = url.search;

  const isDeribit = prefix === '/api/deribit';

  // ── Cloudflare Cache API (Deribit GET responses only) ─────────────────────
  const cache = caches.default;
  if (isDeribit && request.method === 'GET') {
    const cacheKey = new Request(targetUrl.toString());
    const cached = await cache.match(cacheKey);
    if (cached) {
      const resp = new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
      });
      Object.entries(corsHeaders).forEach(([k, v]) => resp.headers.set(k, v));
      return resp;
    }
  }

  // ── Forward request ───────────────────────────────────────────────────────
  const forwardReq = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow',
  });

  let response;
  try {
    response = await fetch(forwardReq);
  } catch (fetchErr) {
    // Network-level failure — try proxy for Deribit
    if (isDeribit && PROXIES.length > 0) {
      try { return await fetchViaProxy(targetUrl.toString()); } catch { /* fall through */ }
    }
    return new Response(JSON.stringify({ error: 'Proxy error', message: fetchErr.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── Deribit 429 → retry via up to 3 different proxies ───────────────────
  if (isDeribit && response.status === 429 && PROXIES.length > 0) {
    const MAX_PROXY_ATTEMPTS = 3;
    let lastErr = 'no proxy tried';
    for (let attempt = 0; attempt < MAX_PROXY_ATTEMPTS; attempt++) {
      try {
        const proxyResp = await fetchViaProxy(targetUrl.toString());
        if (proxyResp.status !== 429) return proxyResp; // success (or non-429 error)
        lastErr = `proxy attempt ${attempt + 1} also rate-limited (429)`;
      } catch (err) {
        lastErr = err.message ?? String(err);
      }
    }
    return new Response(
      JSON.stringify({ error: 'rate_limited', detail: `Direct: 429. ${lastErr}` }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }

  // ── Store successful Deribit GET in cache ─────────────────────────────────
  if (isDeribit && request.method === 'GET' && response.status === 200) {
    const isInstruments = targetUrl.toString().includes('get_instruments');
    const ttl = isInstruments ? 300 : 120; // 5 min for instrument lists, 2 min for candles
    const cloned = response.clone();
    const cacheKey = new Request(targetUrl.toString());
    const cacheResp = new Response(cloned.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheResp));
  }

  // ── Return response with CORS headers ────────────────────────────────────
  const modifiedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.entries(corsHeaders).forEach(([k, v]) => modifiedResponse.headers.set(k, v));
  return modifiedResponse;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleOptions(request);
    return handleRequest(request, ctx);
  },
};
