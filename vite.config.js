import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import dependencyExplorer from './server/plugin.js';

export default defineConfig({
  plugins: [react(), dependencyExplorer()],
  server: {
    port: Number(process.env.PORT) || 5177,
    open: false,
  },
});
