// Minimal service worker — passthrough (disables caching until proper SW is built)
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => {}); // pass through, no cache
