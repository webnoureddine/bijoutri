import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :8000. `npm run dev` also listens on the network (--host),
// so phones and other PCs on the shop Wi-Fi can open http://<this-PC-IP>:5173
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000', '/media': 'http://127.0.0.1:8000' },
  },
  build: { chunkSizeWarningLimit: 900 },
});
