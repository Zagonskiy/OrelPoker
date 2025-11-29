// Я изменил версию кэша на v5 - это заставит телефон обновить код
const CACHE_NAME = 'orelpoker-v5-force-update';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

self.addEventListener('install', (e) => {
    self.skipWaiting(); // Новая версия сразу вступает в силу
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (e) => {
    // Удаляем старый кэш, чтобы не мешал
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
