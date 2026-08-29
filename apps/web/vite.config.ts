import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  // Relative asset URLs. The same build output is served over http:// by the
  // dev/preview server and loaded over file:// by the packaged Electron host
  // (ADR-010: "renderer — обычное браузерное приложение, ровно то же самое,
  // что работает в Chromium без Electron"). Absolute `/assets/...` URLs
  // resolve against the filesystem root under file:// and the page comes up
  // blank — with no error in the main process, because nothing failed there.
  base: './',

  build: {
    // Named explicitly because two other things depend on the path: the
    // Electron main process loads `index.html` from here, and the packaged
    // build copies this directory. A default that moved would break both in
    // ways that only appear after packaging.
    outDir: 'dist',
    emptyOutDir: true,
    // THROWAWAY SPIKE: the second entry point, removed with the spike.
    rollupOptions: { input: { index: 'index.html', spike: 'spike.html' } },
    // Bundles the exact sources; no eval-based sourcemaps that a strict CSP
    // in the packaged host would refuse to execute.
    sourcemap: true
  },

  // Fixed ports, and `strictPort` so a busy port fails loudly instead of
  // silently moving the server somewhere the Playwright config is not looking.
  //
  // The host is spelled as an address rather than left at the default
  // `localhost`: on Windows that name resolves to ::1 first, the server binds
  // IPv6 only, and a client polling 127.0.0.1 is refused. The failure is
  // "Timed out waiting 120000ms from config.webServer" under a log that says
  // the server started successfully — a whole class of "it works when I open
  // it in a browser" confusion.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true }
});
