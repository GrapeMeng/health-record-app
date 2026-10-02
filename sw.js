/* Service Worker（设计 §D-5）：
   预缓存应用壳；导航请求 network-first（拿新版，失败回退缓存=离线可用）；
   静态资源 cache-first；不缓存/不拦截 gitee.com/api 同步请求；版本号变更时清理旧缓存。 */
'use strict';
const VERSION = 'health-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/store.js',
  './js/sync.js',
  './js/app.js',
  './js/records.js',
  './js/period.js',
  './js/settings.js',
  './js/sync-ui.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.indexOf('gitee.com/api') !== -1) return; // 同步 API 走网络，不进缓存（§D-5）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
