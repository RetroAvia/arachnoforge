import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// V41 — la versione mostrata nell'app (barra laterale, Nexus Gate) viene
// da package.json: un solo numero da aggiornare a ogni rilascio.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // V34.3 — risolve il warning Vite/Vercel "Some chunks are larger than
    // 500 kB after minification": prima l'intera app (7 pagine + librerie
    // esterne) finiva in un unico bundle da ~660 kB. Le pagine ora sono
    // già lazy-loaded via React.lazy (vedi App.jsx) — questo manualChunks
    // isola in più le librerie esterne (React stesso + Supabase, che
    // cambiano raramente rispetto al codice applicativo) in chunk dedicati
    // e cacheabili a lungo dal browser fra un deploy e l'altro.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js']
        }
      }
    }
  }
});
