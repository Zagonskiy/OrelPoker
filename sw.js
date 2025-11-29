// Версия v22 - Silent Auto Update
const CACHE_NAME = 'orelpoker-v22-silent';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

// 1. Установка: Сразу активируемся, не ждем
self.addEventListener('install', (e) => {
    self.skipWaiting(); // Самая важная команда: "Не ждать, обновить сразу"
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// 2. Активация: Удаляем старое, захватываем вкладки
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
    return self.clients.claim(); // Немедленно берем под контроль открытую страницу
});

// 3. Работа с сетью
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
