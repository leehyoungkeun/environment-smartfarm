// public/sw.js - SmartFarm Service Worker

const CACHE_NAME = 'smartfarm-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// 설치 - 정적 자원 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('🌱 SmartFarm SW: 캐시 설치');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 활성화 - 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 요청 가로채기 - 네트워크 우선, 실패시 캐시
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 다른 origin 요청은 SW가 가로채지 않음 (헬스체크 등 백엔드 직접 요청)
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

  // 정적 자원 - 네트워크 우선, 실패시 캐시
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request).then((response) => {
          return response || caches.match('/');
        });
      })
  );
});
