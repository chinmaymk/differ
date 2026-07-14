/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [svelte()],

  // Prevent Vite from obscuring Rust errors and configure for Tauri.
  clearScreen: false,
  // Tauri expects a fixed port; fail if it is unavailable.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the Rust side; Cargo handles it.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Env vars starting with these prefixes are exposed to the client.
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  worker: {
    format: 'es',
  },

  build: {
    // Tauri uses a modern webview; target accordingly. Overridable via env.
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    // Produce readable output only in debug builds.
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
}));
