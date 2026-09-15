// The app's own worker code. Plain javascript: the browser evaluates this in a
// worker scope with no build step in front of it.

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Update', {
      body: payload.body,
      data: { url: payload.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data.url))
})
