import { fileURLToPath, URL } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './src/manifest.config';

export default defineConfig({
  build: {
    // Stable, unhashed output names. An extension controls its own versioning,
    // so content-hash cache-busting isn't needed — and it actively hurts: the
    // content-script loader dynamically imports the app chunk by name, so when a
    // rebuild changed the hash the old file was deleted and any already-open tab
    // (SPA navigations keep the old loader in memory) 404'd on the import
    // ("Failed to fetch dynamically imported module") and the overlay could no
    // longer mount. Fixed names mean a rebuild overwrites the same files.
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
        chunkFileNames: 'assets/[name].js',
        entryFileNames: 'assets/[name].js',
      },
    },
    sourcemap: true,
    target: 'esnext',
  },
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // If 5173 is taken, Vite tries 5174, 5175, … HMR uses the same port (no
    // separate hmr.port — pinning that broke HMR when the server moved).
    port: 5173,
    strictPort: false,
  },
});
