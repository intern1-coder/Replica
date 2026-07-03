import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Affinity Workspace',
        short_name: 'Affinity',
        description: 'Property maintenance job management',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f4f5',
        theme_color: '#09090b',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Never serve the SPA shell for backend routes or user uploads
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/uploads\//],
      },
    }),
  ],
  // Dev-only: proxy API + socket to the backend so the frontend can use relative
  // URLs (/api, /socket.io) that also work in production behind Caddy same-origin.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
