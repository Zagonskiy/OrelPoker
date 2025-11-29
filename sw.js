// Версия v25 - Forced Update Check
const CACHE_NAME = 'orelpoker-v25-forced';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

self.addEventListener('install', (e) => {
    // Заставляем новый воркер сразу стать активным, выкидывая старый
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
    // Берем контроль над всеми открытыми вкладками немедленно
    return self.clients.claim();
});

// Стратегия: Network First (Сначала пробуем интернет, если нет - кэш)
// Это гарантирует, что если есть интернет, мы всегда получим свежую версию
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // Если успешно скачали из интернета — кладем в кэш на будущее
                const resClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, resClone);
                });
                return response;
            })
            .catch(() => {
                // Если интернета нет — берем из кэша
                return caches.match(e.request);
            })
    );
});
