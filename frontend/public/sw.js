// public/sw.js - SmartFarm Service Worker
// 빌드 해시 기반 캐시 버전 관리

const CACHE_VERSION = 'smartfarm-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// 설치 - 정적 자원 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] 캐시 설치:', CACHE_VERSION);
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 활성화 - 이전 캐시 정리 (이전 버전만 삭제)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('smartfarm-') && name !== CACHE_VERSION)
          .map((name) => {
            console.log('[SW] 이전 캐시 삭제:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// 요청 가로채기
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 다른 origin 요청은 SW가 가로채지 않음
  if (new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // API 요청은 네트워크만 사용
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ success: false, error: 'Offline' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Vite 빌드 해시가 포함된 assets (*.js, *.css) — 캐시 우선 (immutable)
  if (request.url.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // 기타 정적 자원 — 네트워크 우선, 실패시 캐시
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => {
        return caches.match(request).then((response) => {
          return response || caches.match('/');
        });
      })
  );
});

// 클라이언트에서 업데이트 확인 메시지 처리
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
