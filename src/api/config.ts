/**
 * Конфигурация API endpoints
 * 
 * В режиме разработки используется проксирование через Vite
 * В production используется Cloudflare Worker
 */

const isDev = import.meta.env.DEV;

// URL воркера из переменной окружения или дефолтное значение
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// В dev режиме используем относительные пути (проксируются Vite)
// В prod режиме используем URL воркера
export const API_CONFIG = {
  GAMMA_API_BASE: isDev ? '/api/gamma' : `${WORKER_URL}/api/gamma`,
  CLOB_API_BASE: isDev ? '/api/clob' : `${WORKER_URL}/api/clob`,
  BYBIT_API_BASE: isDev ? '/api/bybit' : `${WORKER_URL}/api/bybit`,
  // get_tradingview_chart_data does NOT support browser CORS — must go through Worker.
  // All other Deribit endpoints (DVOL, instruments) support CORS and are called directly.
  DERIBIT_API_BASE: isDev ? '/api/deribit' : `${WORKER_URL}/api/deribit`,
};


