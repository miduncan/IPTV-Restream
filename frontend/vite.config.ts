import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const appendFrontendTrailingSlash: Plugin = {
  name: 'append-frontend-trailing-slash',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://localhost')
      const isBackendRoute = /^\/(api|socket\.io|proxy|streams)(\/|$)/.test(url.pathname)
      const lastSegment = url.pathname.split('/').pop() || ''
      if (url.pathname !== '/' && !url.pathname.endsWith('/') && !lastSegment.includes('.') && !isBackendRoute) {
        response.statusCode = 301
        response.setHeader('Location', `${url.pathname}/${url.search}`)
        response.end()
        return
      }
      next()
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://localhost')
      const isBackendRoute = /^\/(api|socket\.io|proxy|streams)(\/|$)/.test(url.pathname)
      const lastSegment = url.pathname.split('/').pop() || ''
      if (url.pathname !== '/' && !url.pathname.endsWith('/') && !lastSegment.includes('.') && !isBackendRoute) {
        response.statusCode = 301
        response.setHeader('Location', `${url.pathname}/${url.search}`)
        response.end()
        return
      }
      next()
    })
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), appendFrontendTrailingSlash],
  build: {
    rollupOptions: {
      input: {
        player: 'index.html',
        admin: 'admin/index.html',
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 8080, 
  },
})
