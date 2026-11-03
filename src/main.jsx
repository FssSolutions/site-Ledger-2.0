import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Ask the browser not to evict offline data under storage pressure.
navigator.storage?.persist?.().catch(() => {})

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const announce = w => window.dispatchEvent(new CustomEvent('sl-update-ready', { detail: w }))
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w)
        })
      })
      // Reload once a user-approved update replaces the running version. The
      // very first install also fires controllerchange (clients.claim) and
      // must not reload, or it would wipe whatever the user is typing.
      const hadController = !!navigator.serviceWorker.controller
      let reloaded = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !hadController) return
        reloaded = true
        window.location.reload()
      })
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    } catch { /* offline first load or unsupported */ }
  })
}
