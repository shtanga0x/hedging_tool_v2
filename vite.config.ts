import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: '/',
  server: {
    proxy: {
      '/api/gamma': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gamma/, ''),
      },
      '/api/clob': {
        target: 'https://clob.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/clob/, ''),
      },
      '/api/bybit': {
        target: 'https://api.bybit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bybit/, ''),
      },
      '/api/stooq': {
        target: 'https://stooq.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/stooq/, ''),
      },
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      },
      '/api/pyth': {
        target: 'https://hermes.pyth.network',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pyth/, ''),
      },
      '/api/deribit': {
        target: 'https://www.deribit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deribit/, ''),
      },
    },
  },
})
