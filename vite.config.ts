import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false,
  },
  publicDir: 'public',
  test: {
    globals: true,
    environment: 'node',
  },
} as any);
