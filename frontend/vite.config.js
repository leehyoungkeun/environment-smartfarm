import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
      ...(isFarmLocal ? [stripGoogleFonts()] : []),
      // PWA — 농가 모바일 사용 (현장 통신 음영 대비)
      // 정적 자산 + API GET 응답 일부 캐싱. POST(저장) 는 캐싱 안 함 (의도)
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'SmartFarm 영농일지',
          short_name: 'SmartFarm',
          description: '스마트팜 영농일지 + 모니터링',
          start_url: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#1d4ed8',
          orientation: 'portrait',
          categories: ['utilities', 'productivity'],
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // 큰 파일도 캐싱 (jspdf 등)
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              // 사진 (uploads) — StaleWhileRevalidate
              urlPattern: /\/uploads\//,
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'uploads-cache', expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 } },
            },
            {
              // API GET — NetworkFirst (네트워크 우선, 실패 시 캐시 fallback)
              urlPattern: ({ request, url }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: { cacheName: 'api-cache', expiration: { maxEntries: 100, maxAgeSeconds: 24 * 3600 }, networkTimeoutSeconds: 5 },
            },
          ],
        },
      }),
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
