import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Only React is force-grouped. Everything else is deliberately left to
         * Rollup's own dynamic-import splitting.
         *
         * That is not laziness — it is the fix. `xlsx`, `jspdf`, `jspdf-autotable`
         * and `papaparse` are ~1 MB together, and the obvious move is to name a
         * chunk per library. Doing so made it *worse*: assigning a module to a named
         * manual chunk promotes that chunk into the entry's static import list, so
         * the entry ended up with
         *
         *     import { i } from "./vendor-pdf-….js"
         *
         * and `index.html` gained a `<link rel="modulepreload">` for all 431 kB of
         * jsPDF — fetched on every visit, by every visitor, for a button most never
         * press. Removing the rule let Rollup mark the same file `isDynamicEntry`
         * and drop the preload.
         *
         * React is the exception because it genuinely *is* a static dependency of
         * the entry. Splitting it out costs nothing and lets it be cached across
         * deploys independently of app code, which changes far more often.
         *
         * The regexp is anchored on path separators rather than a bare
         * `includes('react')` so it matches the `react` and `react-dom` packages and
         * not every dependency with "react" somewhere in its path.
         */
        manualChunks: (id) =>
          id.includes('node_modules') && /[\\/]react(-dom)?[\\/]/.test(id)
            ? 'vendor-react'
            : undefined,
      },
    },
    /**
     * The lazily-loaded xlsx chunk is legitimately ~480 kB and will always exceed
     * Rollup's 500 kB advisory once gzip is discounted. Raised so the warning keeps
     * meaning something for the entry chunk — the thing this config exists to keep
     * small — instead of firing every build on a file that is never in the critical
     * path.
     */
    chunkSizeWarningLimit: 600,
  },
})
