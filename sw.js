// Service Worker - minimal for PWA install prompt support
const CACHE_NAME = 'ho-so-thau-v1';

// Install event
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Fetch event - network first, no complex caching
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
