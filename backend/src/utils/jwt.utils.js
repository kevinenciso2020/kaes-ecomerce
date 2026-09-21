import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '15m'
export const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d'
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Los refresh tokens se guardan en BD como hash SHA-256: si alguien lee la
// tabla no obtiene tokens utilizables.
export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex')

export const generateTokens = (user) => {
  // Token de acceso — corta duración (15 minutos por defecto)
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  )

  // Refresh token — larga duración (7 días). `jti` aleatorio para que dos
  // tokens emitidos en el mismo segundo nunca sean idénticos.
  const refreshToken = jwt.sign(
    { id: user.id, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  )

  return { accessToken, refreshToken }
}
