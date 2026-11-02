import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const environment=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env??{}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(environment.WEB_PORT ?? 4188),
    strictPort: true,
    proxy: {
      '/v1': { target: environment.MOCK_API_TARGET ?? 'http://127.0.0.1:4191', changeOrigin: false },
      '/formal': { target: environment.FORMAL_API_TARGET ?? 'http://127.0.0.1:4193', changeOrigin: false, rewrite: path => path.replace(/^\/formal/, '') },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
    proxy: environment.DISABLE_API_PROXY === 'true' ? {} : {
      '/formal': { target: environment.FORMAL_API_TARGET ?? 'http://127.0.0.1:4193', changeOrigin: false, rewrite: path => path.replace(/^\/formal/, '') },
    },
  },
})
