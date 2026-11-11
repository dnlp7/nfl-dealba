/* De Alba Fantasy Football League: service worker (Stage 8).
   Makes the site installable as an app. Network first, always: when online every request
   goes to GitHub as usual (data and site updates show up right away); a copy of each
   response is kept only so the app still opens, with the last data seen, when offline. */
var CACHE = 'dealba-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var ownSite = url.origin === self.location.origin;
  var fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!ownSite && !fonts) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: ownSite && req.mode === 'navigate' });
  }));
});
