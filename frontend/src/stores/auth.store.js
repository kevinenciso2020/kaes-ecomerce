import { atom } from 'nanostores'

export const currentUser = atom(null)
export const authLoading = atom(false)

const USER_STORAGE_KEY = 'user'

const isBrowser = typeof window !== 'undefined'

const readUserFromStorage = () => {
  if (!isBrowser) return null
  const raw = window.localStorage.getItem(USER_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    window.localStorage.removeItem(USER_STORAGE_KEY)
    return null
  }
}

const writeUserToStorage = (user) => {
  if (!isBrowser) return
  if (user) {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
  } else {
    window.localStorage.removeItem(USER_STORAGE_KEY)
  }
}

if (isBrowser) {
  const saved = readUserFromStorage()
  if (saved) currentUser.set(saved)
}

export const setAuth = async (user) => {
  currentUser.set(user)
  writeUserToStorage(user)
  const { initCart } = await import('./cart.store.js')
  await initCart()
}

export const clearAuth = async () => {
  const { logoutCart } = await import('./cart.store.js')
  logoutCart()
  currentUser.set(null)
  writeUserToStorage(null)
}
