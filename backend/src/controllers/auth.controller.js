import * as AuthService from '../services/auth.service.js'

const isProduction = process.env.NODE_ENV === 'production'

// Opciones de cookie:
//  • Con dominio propio (COOKIE_DOMAIN=.kaes.co, front en kaes.co y API en
//    api.kaes.co) las cookies son "first-party": sameSite=lax, funcionan en
//    Safari/iOS y el middleware SSR de Astro también las ve.
//  • Sin dominio propio (vercel.app ↔ railway.app) son cross-site: se necesita
//    sameSite=none; Safari (ITP) puede bloquearlas.
//  • En desarrollo (localhost) sameSite=lax.
const cookieBaseOptions = () => {
  const domain = process.env.COOKIE_DOMAIN || undefined
  const sameSite = domain || !isProduction ? 'lax' : 'none'
  return { httpOnly: true, secure: true, sameSite, path: '/', ...(domain ? { domain } : {}) }
}

const setAuthCookies = (res, accessToken, refreshToken) => {
  const base = cookieBaseOptions()
  res.cookie('accessToken',  accessToken,  { ...base, maxAge: 15 * 60 * 1000 })
  // El refresh token sólo viaja a /api/v1/auth (refresh/logout).
  res.cookie('refreshToken', refreshToken, { ...base, path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000 })
}

const clearAuthCookies = (res) => {
  const base = cookieBaseOptions()
  res.clearCookie('accessToken',  base)
  res.clearCookie('refreshToken', { ...base, path: '/api/v1/auth' })
  // Cookie antigua con path "/" (antes del cambio de path)
  res.clearCookie('refreshToken', base)
}

export const register = async (req, res, next) => {
  try {
    const { name, email, password, acceptPrivacy } = req.body

    // Tras registrarse el usuario NO está logueado — debe verificar su email primero
    const result = await AuthService.registerUser({ name, email, password, acceptPrivacy: acceptPrivacy === true || acceptPrivacy === 'true' })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body

    const result = await AuthService.loginUser({ email, password })
    setAuthCookies(res, result.accessToken, result.refreshToken)
    // Los tokens sólo viajan en cookies httpOnly (no en el body).
    res.json({ user: result.user })
  } catch (err) {
    next(err)
  }
}

export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken

    if (!refreshToken) {
      return res.status(401).json({ error: 'Sesión expirada' })
    }

    const result = await AuthService.refreshAccessToken(refreshToken)
    setAuthCookies(res, result.accessToken, result.refreshToken)
    res.json({ user: result.user })
  } catch (err) {
    if (err.status === 401) clearAuthCookies(res)
    next(err)
  }
}

export const logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (refreshToken) await AuthService.logoutUser(refreshToken)
    clearAuthCookies(res)
    res.json({ message: 'Sesión cerrada correctamente' })
  } catch (err) {
    next(err)
  }
}

export const me = async (req, res) => {
  // req.user lo inyecta el middleware isAuth
  res.json({ user: req.user })
}

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query

    if (!token) {
      return res.status(400).json({ error: 'Token de verificación requerido' })
    }

    const result = await AuthService.verifyEmailToken(token)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email requerido' })
    }

    const result = await AuthService.resendVerificationEmail(email)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const checkVerification = async (req, res, next) => {
  try {
    const result = await AuthService.getVerificationStatus(req.user.id)
    res.json({ status: result })
  } catch (err) {
    next(err)
  }
}

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email requerido' })
    }

    const result = await AuthService.requestPasswordReset(email)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const resetPassword = async (req, res, next) => {
  try {
    const { email, code, password, confirmPassword } = req.body

    if (!email || !code || !password) {
      return res.status(400).json({ error: 'Email, código y contraseña son requeridos' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' })
    }

    const result = await AuthService.resetPasswordWithOtp({
      email,
      code: code.trim(),
      newPassword: password,
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
}