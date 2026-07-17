self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()

  event.waitUntil(
    self.registration.showNotification(data.title || 'แจ้งเตือน', {
      body:    data.body    || '',
      icon:    data.icon    || '/cherd-icon.png',
      badge:   data.badge   || '/cherd-icon.png',
      data:    data.meta    || {},
      actions: data.actions || [],
      tag:     data.tag     || 'pos-notify',
      requireInteraction: true,
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const meta   = event.notification.data || {}
  const action = event.action

  if ((action === 'approve' || action === 'reject') && meta.type && meta.id) {
    event.waitUntil(
      fetch('/api/push/action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, type: meta.type, id: meta.id }),
      })
    )
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(wins => {
        if (wins.length) wins[0].focus()
        else clients.openWindow('/')
      })
    )
  }
})
