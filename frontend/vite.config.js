import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 팜로컬 빌드: Google Fonts @import 제거 플러그인
function stripGoogleFonts() {
  return {
    name: 'strip-google-fonts',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.endsWith('.css') && chunk.source) {
          chunk.source = chunk.source.replace(
            /@import\s*(?:url\()?["']https:\/\/fonts\.googleapis\.com[^"']*["']\)?;?/g,
            '/* google fonts stripped for farm-local */'
          )
        }
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isFarmLocal = env.VITE_FARM_LOCAL === 'true'

  return {
    plugins: [
      react(),
      ...(isFarmLocal ? [stripGoogleFonts()] : [])
    ],
    base: isFarmLocal ? './' : '/',
    build: {
      outDir: isFarmLocal ? 'dist-farmlocal' : 'dist',
    },
    server: {
      port: 5174,
      host: true,
      open: true
    }
  }
})
