import * as AuthService from '../services/auth.service.js'

const isProduction = process.env.NODE_ENV === 'production'

const setAuthCookies = (res, accessToken, refreshToken) => {
  // En producción front (Vercel) y back (Railway) viven en dominios distintos,
  // así que el cookie debe cruzar el cross-origin XHR. Eso exige
  // `sameSite: 'none' + secure: true`. En desarrollo local todo va por
  // `localhost` same-site, así que `sameSite: 'lax'` basta y evita fricciones
  // con herramientas que no envían `secure` (curl, supertest, etc).
  const sameSite = isProduction ? 'none' : 'lax'

  const baseOptions = {
    httpOnly: true,
    secure:   true,
    sameSite,
    path:     '/',
  }

  res.cookie('accessToken',  accessToken,  { ...baseOptions, maxAge: 15 * 60 * 1000 })
  res.cookie('refreshToken', refreshToken, { ...baseOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
}

const clearAuthCookies = (res) => {
  const clearOptions = { path: '/' }
  res.clearCookie('accessToken',  clearOptions)
  res.clearCookie('refreshToken', clearOptions)
}

export const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    }

    // Tras registrarse el usuario NO está logueado — debe verificar su email primero
    const result = await AuthService.registerUser({ name, email, password })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' })
    }

    const result = await AuthService.loginUser({ email, password })
    setAuthCookies(res, result.accessToken, result.refreshToken)
    res.json({ user: result.user, accessToken: result.accessToken })
  } catch (err) {
    next(err)
  }
}

export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token requerido' })
    }

    const result = await AuthService.refreshAccessToken(refreshToken)
    setAuthCookies(res, result.accessToken, result.refreshToken)
    res.json({ user: result.user, accessToken: result.accessToken })
  } catch (err) {
    next(err)
  }
}

export const logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken
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