// Service Worker per LombardaFlor Orders PWA
// v142 - Selettore anagrafica: testo prepopolato selezionato + tasto pulisci + soglia 1 char
const CACHE_NAME = 'lombardaflor-orders-v158-quickmark-fix';
const STATIC_CACHE = 'lombardaflor-static-v158-quickmark-fix';
const API_CACHE = 'lombardaflor-api-v158-quickmark-fix';

const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles-mobile-optimized.css',
  '/pull-to-refresh-styles.css',
  '/app.js',
  '/pull-to-refresh.js',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Installazione - precache risorse statiche
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Attivazione - rimuovi cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== API_CACHE && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - strategia ibrida
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Solo GET requests
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }
  
  // Portale clienti (pagina e asset) + magic link: MAI cache, sempre network
  if (url.pathname === '/cliente' ||
      url.pathname === '/cliente.html' ||
      url.pathname === '/cliente.js' ||
      url.pathname === '/cliente.css' ||
      url.pathname.startsWith('/c/')) {
    event.respondWith(fetch(request));
    return;
  }
  
  // Risorse statiche: Cache First
  if (urlsToCache.some(path => url.pathname.endsWith(path))) {
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) {
            return cached;
          }
          return fetch(request).then((response) => {
            return caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, response.clone());
              return response;
            });
          });
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }
  
  // API: Network Only (NO CACHE!) - Sempre dati freschi dal server
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .catch((error) => {
          console.error('API network error:', error);
          return new Response('{"error": "Network error"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // Tutto il resto: Network First
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        }).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ==========================================
// PUSH NOTIFICATIONS
// ==========================================

// Gestione notifiche push
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    
    // Se il payload include orderId/date, aggiungiamo l'azione "Apri ordine"
    // per saltare direttamente al giorno dell'ordine al tap.
    const hasOrderDeeplink = data.data && (data.data.orderId || data.data.date);
    const actions = hasOrderDeeplink
      ? [{ action: 'open-order', title: 'Apri ordine' }]
      : [{ action: 'open', title: 'Apri app' }];
    
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-192.png',
      tag: data.tag || 'notification',
      requireInteraction: data.requireInteraction || false,
      vibrate: [200, 100, 200],
      data: data.data || {},
      actions,
      timestamp: Date.now(),
      renotify: true
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (error) {
    console.error('Errore push notification:', error);
  }
});

// Click su notifica: deeplink al giorno/ordine se presente in data.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const data = event.notification.data || {};
  
  // URL target: se l'ordine ha una data, naviga lì
  let targetUrl = '/';
  if (data.date) {
    targetUrl = `/?date=${encodeURIComponent(data.date)}`;
    if (data.orderId) targetUrl += `&orderId=${encodeURIComponent(data.orderId)}`;
  } else if (data.orderId) {
    targetUrl = `/?orderId=${encodeURIComponent(data.orderId)}`;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Se c'è già una finestra dell'app aperta, la focusiamo e le
        // mandiamo un messaggio per navigare al giorno/ordine.
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            if ('navigate' in client && data.date) {
              // Navigate ricarica la pagina con il querystring (mantiene la stessa tab)
              return client.focus().then(() => client.navigate(targetUrl));
            }
            // Fallback: posta un messaggio all'app già aperta
            if ('postMessage' in client && data.date) {
              client.postMessage({ type: 'open-order', orderId: data.orderId, date: data.date });
            }
            return client.focus();
          }
        }
        // Nessuna finestra aperta: apriamo
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
