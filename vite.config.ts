import { defineConfig } from 'vite';

const CLIENT_PORT = Number(process.env.CODETOWN_CLIENT_PORT ?? 3667);
const SERVER_PORT = Number(process.env.CODETOWN_PORT ?? 3666);

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '127.0.0.1',
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://127.0.0.1:${SERVER_PORT}` },
    },
  },
});
