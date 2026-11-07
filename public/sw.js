const CACHE_NAME = 'shipyard-hub-v3';
const MAINTENANCE_PAGE = '/maintenance.html';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app_icon.png',
  '/app_icon.svg',
  MAINTENANCE_PAGE
];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Drop caches of older versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
});

// A page the server can't answer (stopped or restarting during a deploy, or
// the proxy's 502/503/504) shows ShipHub's own maintenance page instead of the
// proxy's error.
const serverDown = status => status === 502 || status === 503 || status === 504;
const maintenancePage = () => caches.match(MAINTENANCE_PAGE);

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pages: network first. The root keeps a cached copy for offline use.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (serverDown(response.status)) {
            return maintenancePage().then(page => page || response);
          }
          if (url.pathname === '/' || url.pathname === '/index.html') {
            const clonedResponse = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || maintenancePage()))
    );
    return;
  }

  // For index.html and root, use Network First strategy
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update the cache with the latest version
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clonedResponse);
          });
          return response;
        })
        .catch(() => caches.match(event.request)) // Fallback to cache if offline
    );
    return;
  }

  // API calls always go to the network (the app shows its own maintenance
  // screen when they fail).
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // For other assets, use Cache First strategy
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
