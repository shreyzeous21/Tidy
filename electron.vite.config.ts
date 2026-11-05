import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * Shared path alias maps. `@shared` gives all three processes access to the
 * shared type/constant modules; `@` is the renderer source root used by shadcn/ui.
 */
const sharedAlias = { '@shared': resolve(import.meta.dirname, 'shared') }

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAlias
    },
    // All runtime dependencies are externalized. chokidar in particular must
    // NOT be bundled: its optional native `fsevents` addon cannot survive the
    // bundler, and bundling yields a broken `require('fsevents')` whose
    // `flags.SinceNow` is undefined (crashes the watcher on macOS).
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@': resolve(import.meta.dirname, 'src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        // Strict CSP in production; a relaxed variant (inline script + HMR websocket)
        // only while the Vite dev server is active.
        name: 'tidy:csp',
        transformIndexHtml(html, ctx) {
          const dev = Boolean(ctx.server)
          const csp = dev
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws:"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
          return html.replace('__CSP__', csp)
        }
      }
    ]
  }
})
