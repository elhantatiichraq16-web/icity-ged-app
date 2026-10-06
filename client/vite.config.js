import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 127.0.0.1 uniquement (§2), port fixe : les liens des e-mails y pointent.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Les appels /api partent vers le serveur Node. Pour le navigateur, tout
    // vient de la même adresse : le cookie de session suit sans réglage.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Pas de police (ni d'image) glissée dans le CSS en « data: » : la CSP du
    // serveur (font-src 'self') la bloquerait. Chaque fichier reste un fichier.
    assetsInlineLimit: 0,
  },
});
