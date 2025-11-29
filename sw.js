// Версия v30 - Rescue Mode (Fix Infinite Loading)
const CACHE_NAME = 'orelpoker-v30-rescue';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    // Я убрал логотип отсюда, чтобы из-за него не ломался весь сайт
    // Он всё равно загрузится и закэшируется, когда вы откроете страницу
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
