var CACHE_NAME = "nuvio-vidaa-v4";
// Player/plugin libraries enter the runtime cache on first use, keeping startup light.
var ASSETS = [
  "./",
  "./index.html",
  "./vidaa.html",
  "./manifest.json",
  "./boot-guard.js",
  "./core-js.bundle.js",
  "./nuvio.env.js",
  "./app.bundle.js",
  "./assets/runtime/legacy-features.js",
  "./assets/libs/qrcode-generator.js",
  "./css/bundle.css"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(
          ASSETS.map(function (asset) {
            return new Request(asset, { cache: "reload" });
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function (err) {
        console.warn("[SW] Cache install warning:", err);
      })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf("nuvio-vidaa-") === 0 && n !== CACHE_NAME;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var requestUrl = new URL(req.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Let Vercel cache complete image variant URLs without offline-cache rewriting.
  if (requestUrl.pathname === "/_vercel/image" || requestUrl.pathname.indexOf("/api/") === 0)
    return;

  // Build-hashed assets are immutable. Exact URL matching also prevents an
  // older worker serving the wrong build while a new document is starting.
  if (/\.[a-f0-9]{16}\.(js|css)$/.test(requestUrl.pathname) && !requestUrl.search) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (cached) {
          if (cached) return cached;
          return fetch(req).then(function (response) {
            if (!response || !response.ok) return response;
            var copy = response.clone();
            e.waitUntil(cache.put(req, copy).catch(function () {}));
            return response;
          });
        });
      })
    );
    return;
  }

  // Never touch media range requests or video stream files
  if (req.headers && req.headers.get("range")) return;
  if (/\.(mkv|mp4|m4v|webm|m3u8|ts|mpd|mov)(\?|$)/i.test(req.url)) return;

  var normalizedRequest = req;
  if (req.url.indexOf("?") !== -1) {
    var url = new URL(req.url);
    url.search = "";
    normalizedRequest = new Request(url.toString());
  }

  function updateCacheFromNetwork() {
    return fetch(req, { cache: "no-store" }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error("App resource unavailable");
      }
      if (response && response.status === 200) {
        var clone = response.clone();
        return caches
          .open(CACHE_NAME)
          .then(function (cache) {
            return cache.put(normalizedRequest, clone);
          })
          .then(function () {
            return response;
          })
          .catch(function () {
            return response;
          });
      }
      return response;
    });
  }

  var isAppShellRequest =
    req.mode === "navigate" ||
    req.destination === "document" ||
    req.destination === "script" ||
    req.destination === "worker" ||
    req.destination === "style" ||
    req.destination === "font" ||
    req.destination === "image" ||
    /\.(html|js|css|wasm)(\?|$)/i.test(req.url);

  if (isAppShellRequest) {
    e.respondWith(
      // Check the network at app launch; reuse this build's cache when offline.
      updateCacheFromNetwork().catch(function (error) {
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(normalizedRequest).then(function (cached) {
            if (cached) return cached;
            if (req.mode === "navigate" || req.destination === "document") {
              return cache.match("./index.html");
            }
            throw error;
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(normalizedRequest).then(function (response) {
        return response || fetch(req);
      });
    })
  );
});
