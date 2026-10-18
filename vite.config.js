import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
    manifest: {
      name: 'PDF Privacy Redactor',
      short_name: 'PDF Redactor',
      description: 'Offline-first bank statement PDF redaction, processed on your device',
      theme_color: '#14263e',
      background_color: '#f5f7fb',
      display: 'standalone',
      start_url: './',
      scope: './',
      icons: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
      // There is intentionally no runtime caching. User PDFs are never cached.
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
      navigateFallback: 'index.html',
      maximumFileSizeToCacheInBytes: 8000000
    }
  })],
  build: { target: 'es2022' }
});
