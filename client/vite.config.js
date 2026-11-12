import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import JavaScriptObfuscator from 'javascript-obfuscator'

// Production builds only: the app's own code is obfuscated (renamed identifiers, encoded and shuffled
// strings, self-defending against reformatting). Third-party libraries go to a separate "vendor" chunk
// and are left as is (they're public code anyway, and obfuscating them would slow the app).
// No source maps are emitted and console/debugger statements are removed.
function obfuscateAppCode() {
  return {
    name: 'obfuscate-app-code',
    apply: 'build',
    renderChunk(code, chunk) {
      if (chunk.name === 'vendor') return null
      const out = JavaScriptObfuscator.obfuscate(code, {
        target: 'browser',
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        selfDefending: true,
        simplify: true,
        numbersToExpressions: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 1,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        stringArrayCallsTransform: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersType: 'function',
        transformObjectKeys: false, // keeps React props / API field names working
        controlFlowFlattening: false, // big slowdown on a large bundle for little gain
        deadCodeInjection: false,
        debugProtection: false, // needs eval(), which the Content-Security-Policy blocks
        disableConsoleOutput: true,
        sourceMap: false,
      })
      return { code: out.getObfuscatedCode(), map: null }
    },
  }
}

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE || '/', // GitHub Pages build sets VITE_BASE=/<repo>/
  plugins: [react(), obfuscateAppCode()],
  esbuild: command === 'build' ? { drop: ['console', 'debugger'], legalComments: 'none' } : {},
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
}))
