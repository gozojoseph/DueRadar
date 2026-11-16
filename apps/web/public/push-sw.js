/*
 * DueRadar web push handlers.
 *
 * This file is copied verbatim into the build output and imported by the
 * generated Workbox service worker via `workbox.importScripts`.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "DueRadar", body: event.data.text() };
  }

  const title = typeof payload.title === "string" ? payload.title : "DueRadar";
  const body = typeof payload.body === "string" ? payload.body : "You have an upcoming date.";
  const url = typeof payload.url === "string" ? payload.url : "/dashboard";
  const tag = typeof payload.tag === "string" ? payload.tag : undefined;

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url },
    tag,
    renotify: Boolean(tag),
    requireInteraction: false,
    actions: [{ action: "open", title: "Open DueRadar" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || "/dashboard",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      // Prefer an already-open DueRadar window before spawning a new one.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* navigation can fail if the window closed mid-flight */
            }
          }
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The app re-registers on its next visit. Keeping this listener avoids a
  // browser warning when a subscription expires in the background.
  event.waitUntil(Promise.resolve());
});
