// Версия v27 - Player Reset Button
const CACHE_NAME = 'orelpoker-v27-reset-player';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

self.addEventListener('install', (e) => {
    self.skipWaiting(); 
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
