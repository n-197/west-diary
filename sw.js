'use strict';

// オフラインでも開けるように、アプリ本体・カタログ・ジャケット画像・フォントを端末に保存する。
// アプリのファイルを変えて公開し直すときは VERSION を上げる。
const VERSION = 'v6';
const APP_CACHE = `west-diary-app-${VERSION}`;
const ASSET_CACHE = 'west-diary-assets';  // ジャケット画像・フォント（作品が変わらない限り使い回す）

const APP_FILES = [
  './',
  'noart/',
  'index.html',
  'style.css',
  'app.js',
  'theme.js',
  'catalog.json',
  'manifest.webmanifest',
  'noart/manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

const ASSET_HOSTS = ['is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com',
  'is5-ssl.mzstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('west-diary-app-') && k !== APP_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 保存済みのものをすぐ返し、裏で新しい版を取り直す（次に開いたときに反映される）
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const res = await network;
  if (res) return res;
  if (request.mode === 'navigate') {
    // ジャケ写なし版（noart/）を開いたときは、ジャケ写なし版のページを返す
    const page = new URL(request.url).pathname.includes('/noart/') ? 'noart/' : 'index.html';
    return (await cache.match(page)) || Response.error();
  }
  return Response.error();
}

// 一度保存したら取り直さない（ジャケット画像・フォント）
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_CACHE));
  } else if (ASSET_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // 試聴の音声や外部サイトは保存せず、そのまま通信する
});
