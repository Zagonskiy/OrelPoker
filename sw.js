const CACHE_NAME = 'orelpoker-v1';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

// Установка: Скачиваем файлы в память телефона
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Работа без интернета: Отдаем файлы из памяти
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
