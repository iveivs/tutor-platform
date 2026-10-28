// Tyuttori service worker: shows Web Push notifications, keeps the icon badge in sync and
// opens the right section on click. It does not cache pages or API responses.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function setBadge(count) {
  if (typeof count !== "number" || !("setAppBadge" in self.navigator)) return Promise.resolve();
  return (count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge()).catch(() => undefined);
}

function sameOriginPath(value) {
  try {
    const url = new URL(value || "/", self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Тьюттори";
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/app-icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      renotify: typeof data.tag === "string",
      data: { url: sameOriginPath(data.url) },
    }),
    setBadge(data.badge),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = sameOriginPath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus().catch(() => undefined);
      open.postMessage({ type: "tyuttori:open", path });
      return;
    }
    await self.clients.openWindow(path);
  })());
});

// The browser rotated the subscription: save the new one for the same account.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    if (!options || !options.applicationServerKey) return;
    const subscription = event.newSubscription || await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: options.applicationServerKey,
    });
    const json = subscription.toJSON();
    await fetch("/api/push/subscription", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, language: "ru" }),
    });
  })().catch(() => undefined));
});
