/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Migração incremental (strangler fig) do sistema legado vanilla JS para React.
// Ver C:\Users\jorge\.claude\plans\magical-gliding-gem.md para o plano completo.
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev: fala com o Express já rodando em localhost:3000 (npm run dev na raiz)
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Nomes fixos (sem hash) — server.js referencia esses arquivos direto em
        // index.html sem precisar re-templatizar a cada build.
        entryFileNames: 'react-app.js',
        chunkFileNames: 'react-app-[name].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'react-app.css' : 'assets/[name][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
