import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  // dev: the app runs on Vite's port; custom covers live on the app server
  server: { proxy: { '/media': 'http://localhost:4747' } },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
});
