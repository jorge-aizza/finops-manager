/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Migração incremental (strangler fig) do sistema legado vanilla JS para React.
// Ver C:\Users\jorge\.claude\plans\magical-gliding-gem.md para o plano completo.
//
// Dois entry points: 'main' (SPA autenticada, montada em #react-root do
// index.html legado) e 'portal' (Portal Público, montado em #portal-root do
// portal.html legado). Bundles separados de propósito — usuários anônimos do
// portal não devem baixar o código das 7 telas internas autenticadas.
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
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        portal: fileURLToPath(new URL('./portal.html', import.meta.url)),
      },
      output: {
        // Nomes fixos (sem hash) — server.js/index.html/portal.html referenciam
        // esses arquivos direto, sem precisar re-templatizar a cada build.
        entryFileNames: (chunk) => (chunk.name === 'portal' ? 'portal-app.js' : 'react-app.js'),
        chunkFileNames: 'chunks/[name]-[hash].js',
        // CSS não é diferenciada por entry — os dois bundles importam só o
        // mesmo reset global (index.css), então compartilham um único
        // react-app.css (hoje ~0 bytes); portal.html referencia esse mesmo
        // arquivo. Evita a API instável de nomear asset por entry de origem.
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'react-app.css' : 'assets/[name][extname]'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
