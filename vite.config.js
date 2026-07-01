import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        auth: resolve(__dirname, 'frontend/auth.html'),
        admin: resolve(__dirname, 'frontend/admin.html'),
        'super-admin': resolve(__dirname, 'frontend/super-admin.html'),
      },
    },
  },
  server: {
    port: 3000,
  },
});
