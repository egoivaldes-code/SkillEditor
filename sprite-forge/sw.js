// Service Worker for CRIPTA Sprite Forge
// Scope: /SkillEditor/sprite-forge/ when served from GitHub Pages
const CACHE = 'cripta-sprite-forge-v11';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './js/app-core.js',
  './js/app-cloud.js',
  './js/app-ui.js',
  './js/app-frames.js',
  './js/app-cutter.js',
  './js/app-sheets.js',
  './js/app-utils.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Network-first: try live, fall back to cache, then to index.html
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request)
          .then(hit => hit || caches.match('./index.html'))
      )
  );
});
