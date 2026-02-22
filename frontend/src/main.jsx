import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA Service Worker 등록 + 자동 업데이트 감지
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[SW] 등록 성공:', registration.scope);

        // 주기적 업데이트 확인 (1시간마다)
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);

        // 새 SW 감지 시 자동 활성화
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 새 버전 설치 완료 → 즉시 활성화
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              console.log('[SW] 새 버전 감지 → 활성화');
            }
          });
        });
      })
      .catch((error) => {
        console.log('[SW] 등록 실패:', error);
      });

    // 새 SW가 활성화되면 페이지 새로고침
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
