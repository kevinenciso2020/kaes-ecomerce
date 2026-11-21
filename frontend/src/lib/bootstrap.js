import { currentUser } from '../stores/auth.store.js'
import { bootstrapAuth } from '../lib/api.js'

let bootPromise = null

if (typeof window !== 'undefined') {
  bootPromise = (async () => {
    const user = await bootstrapAuth()
    if (!user) {
      const path = window.location.pathname
      // /checkout NO es zona protegida: se puede comprar como invitado. Las páginas
      // de pago (resultado, transferencia) validan sesión o token por su cuenta.
      const isProtected = path.startsWith('/admin') ||
                         path.startsWith('/perfil')
      if (isProtected && !currentUser.get()) {
        window.location.href = '/auth/login?redirect=' + encodeURIComponent(path)
      }
    }
  })()
}

export const awaitBootstrap = () => bootPromise