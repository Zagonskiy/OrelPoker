// Версия v24 - New Header Layout (Text + Round Logo)
const CACHE_NAME = 'orelpoker-v24-header';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './logo.png', // Убедитесь, что файл logo.png есть на сервере
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

// 1. Установка: Сразу активируемся
self.addEventListener('install', (e) => {
    self.skipWaiting(); 
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
    return self.clients.claim();
});

// 3. Работа с сетью
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
