// Custom service-worker snippet (bundled via next-pwa customWorkerSrc).
// Background Sync handler: when the OS wakes us with the replay tag
// (Chrome/Android only — iOS Safari has no Background Sync), fan the
// replay request out to every open client. Clients own the IndexedDB
// queue + Supabase auth, so they do the actual replay; the SW is just
// the wake-up call. Online-event listener + manual Retry cover the rest.

self.addEventListener('sync', (event) => {
  if (event.tag !== 'replay-mutations') return
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach((client) => {
        client.postMessage({ type: 'REPLAY_MUTATIONS' })
      })
    })()
  )
})
