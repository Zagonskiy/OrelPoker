// Версия v36 - Force Cache Reset
const CACHE_NAME = 'orelpoker-v36-reset';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

self.addEventListener('install', (e) => {
    self.skipWaiting(); // Принудительно заменяем старый SW
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
    return self.clients.claim(); // Захватываем управление страницей
});

self.addEventListener('fetch', (e) => {
    // Стратегия: Network First (Сначала пробуем интернет, если нет — берем из кэша)
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                const resClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, resClone);
                });
                return response;
            })
            .catch(() => {
                return caches.match(e.request);
            })
    );
});
