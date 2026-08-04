/* 南区インフォ — オフライン表示とバックグラウンドでの新着確認 */

const VERSION = 'v1';
const SHELL_CACHE = `minami-shell-${VERSION}`;
const DATA_CACHE = `minami-data-${VERSION}`;
const DATA_PATH = 'data/news.json';

const SHELL_ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('minami-') && key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // お知らせデータは常に最新を優先し、取れないときだけキャッシュを返す
  if (url.pathname.endsWith(DATA_PATH)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(DATA_PATH, copy));
          return response;
        })
        .catch(() => caches.open(DATA_CACHE).then((cache) => cache.match(DATA_PATH)))
    );
    return;
  }

  // 画面のファイルはキャッシュ優先。裏側で更新しておく
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/** 保存済みデータと比べて、増えた記事を返す。 */
async function findNewItems() {
  const cache = await caches.open(DATA_CACHE);
  const previousResponse = await cache.match(DATA_PATH);
  const previous = previousResponse ? await previousResponse.json().catch(() => null) : null;

  const response = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return { added: [], data: null };
  const data = await response.json();
  await cache.put(DATA_PATH, new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  }));

  if (!previous || !Array.isArray(previous.items)) return { added: [], data };
  if (previous.revision && data.revision && previous.revision === data.revision) return { added: [], data };

  const knownIds = new Set(previous.items.map((item) => item.id));
  return { added: data.items.filter((item) => !knownIds.has(item.id)), data };
}

async function checkForNews() {
  const { added } = await findNewItems();
  if (added.length === 0) return;

  const urgent = added.filter((item) => item.important);
  const title = urgent.length > 0 ? '南区の重要なお知らせ' : '南区の新しいお知らせ';
  const body = added.length === 1 ? added[0].title : `${added[0].title} ほか${added.length - 1}件`;

  await self.registration.showNotification(title, {
    body,
    tag: 'minami-info-update',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: './' },
  });

  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage({ type: 'news-updated' });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'minami-news-check') event.waitUntil(checkForNews());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'minami-news-check') event.waitUntil(checkForNews());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(target.replace(/index\.html$/, '')) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
