import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js')
      await navigator.serviceWorker.ready
      // No primeiro acesso os assets carregam antes de o SW assumir a página;
      // rebusca-os já sob controle do SW para que o cache offline fique completo.
      const warmCache = () => {
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => {
            try {
              return new URL(url).origin === location.origin
            } catch {
              return false
            }
          })
          .forEach((url) => fetch(url).catch(() => {}))
      }
      if (navigator.serviceWorker.controller) warmCache()
      else navigator.serviceWorker.addEventListener('controllerchange', warmCache, { once: true })
    } catch {
      // sem service worker o app segue funcionando, só não abre offline
    }
  })
}
