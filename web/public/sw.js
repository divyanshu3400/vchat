/* vChat service worker: installable app, fast start, an offline page, and push notifications.
 * Chats and the API are never cached: they always come from the network. */

const VERSION = "v1";
const STATIC_CACHE = `vchat-static-${VERSION}`;
const PAGE_CACHE = `vchat-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((c) => c.addAll([OFFLINE_URL, "/app-icon/192"]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) return;

  // Built files never change under the same name: serve them from the phone.
  if (!DEV && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/app-icon/"))) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: always fresh from the network; the offline page when there is none.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

// --- push notifications -------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "vChat", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "vChat";
  const options = {
    body: data.body || "",
    icon: data.icon || "/app-icon/192",
    badge: "/app-icon/badge",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/chat" },
  };
  const jobs = [self.registration.showNotification(title, options)];
  if (typeof data.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
    jobs.push(data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge());
  }
  event.waitUntil(Promise.all(jobs).catch(() => undefined));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/chat", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // An open vChat window: bring it forward and go to the chat.
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.focus().then((fw) => (fw && "navigate" in fw ? fw.navigate(target) : fw));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
