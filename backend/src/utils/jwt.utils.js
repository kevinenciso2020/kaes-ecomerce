import jwt from 'jsonwebtoken'

export const generateTokens = (user) => {
  // Token de acceso — corta duración (15 minutos)
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  )

  // Refresh token — larga duración (7 días)
  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN }
  )

  return { accessToken, refreshToken }
}