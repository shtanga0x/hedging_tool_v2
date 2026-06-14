/**
 * Cloudflare Worker — CORS proxy for the hedging tool's market-data upstreams.
 *
 * Routes:
 *   /api/gamma/*  -> https://gamma-api.polymarket.com/*
 *   /api/clob/*   -> https://clob.polymarket.com/*
 *   /api/bybit/*  -> https://api.bybit.com/*
 *   /api/stooq/*  -> https://stooq.com/*
 *   /api/yahoo/*  -> https://query1.finance.yahoo.com/*
 *   /api/pyth/*   -> https://hermes.pyth.network/*
 *
 * Deribit is NOT proxied here — the client talks to Deribit directly over
 * WebSocket + CORS-enabled HTTPS (see src/api/deribit.ts), so each user has
 * their own rate-limit bucket and no shared proxy is needed.
 *
 * CORS is restricted to the app's own origins so the worker can't be abused
 * as a generic open proxy from arbitrary websites.
 */

// ─── Allowed browser origins ──────────────────────────────────────────────────
// Requests from these origins get CORS headers; anything else is not granted
// cross-origin access (the browser will block the response).
const ALLOWED_ORIGINS = new Set([
  'https://app.shtanga.xyz',
]);
// Local dev / `vite preview` against the deployed worker.
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin);
}

/** Build CORS headers for a given request origin (empty if not allowed). */
function corsHeadersFor(origin) {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const ROUTES = {
  '/api/gamma': 'https://gamma-api.polymarket.com',
  '/api/clob':  'https://clob.polymarket.com',
  '/api/bybit': 'https://api.bybit.com',
  '/api/stooq': 'https://stooq.com',
  '/api/yahoo': 'https://query1.finance.yahoo.com',
  '/api/pyth':  'https://hermes.pyth.network',
};

function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const cors = corsHeadersFor(origin);
  if (origin && request.headers.get('Access-Control-Request-Method') && cors['Access-Control-Allow-Origin']) {
    return new Response(null, { headers: cors });
  }
  return new Response(null, { headers: { Allow: 'GET, POST, OPTIONS' } });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const origin = request.headers.get('Origin');
  const cors = corsHeadersFor(origin);

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
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const targetPath = pathname.replace(prefix, '') || '/';
  const targetUrl = new URL(targetPath, targetBase);
  targetUrl.search = url.search;

  const isYahoo = prefix === '/api/yahoo';

  const forwardHeaders = new Headers(request.headers);
  // Strip hop-by-hop / origin-revealing headers before forwarding upstream.
  forwardHeaders.delete('Origin');
  forwardHeaders.delete('Referer');
  if (isYahoo) {
    forwardHeaders.set('User-Agent', 'Mozilla/5.0');
    forwardHeaders.set('Accept', 'application/json,text/plain,*/*');
  }

  const forwardReq = new Request(targetUrl.toString(), {
    method: request.method,
    headers: forwardHeaders,
    body: request.body,
    redirect: 'follow',
  });

  let response;
  try {
    response = await fetch(forwardReq);
  } catch (fetchErr) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: fetchErr.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const modifiedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.entries(cors).forEach(([k, v]) => modifiedResponse.headers.set(k, v));
  return modifiedResponse;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return handleOptions(request);
    // Only GET/POST are used by the app; reject everything else early.
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    return handleRequest(request);
  },
};
