import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { prisma } from '../config/prisma.js'
import { generateTokens, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from '../utils/jwt.utils.js'
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'auth' })

const VERIFICATION_TOKEN_BYTES = 32
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 horas

const RESET_CODE_EXPIRY_MS = 10 * 60 * 1000 // 10 minutos — ventana corta para OTP
const RESET_MAX_ATTEMPTS = 5

// Margen para refresh concurrentes con el mismo token (varias pestañas).
const REFRESH_REUSE_GRACE_MS = 30 * 1000
// Cuánto se conserva la fila de un refresh token ya rotado.
const ROTATED_TOKEN_RETENTION_MS = 60 * 60 * 1000

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex')

export const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '2026-09-21'

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '')

// Hash bcrypt de relleno para igualar el tiempo de respuesta cuando el email
// no existe (evita enumerar usuarios por timing).
const DUMMY_HASH = '$2a$12$L80fgnd.upFx09OVjkTdAO6dAjwOJXSRtZt5KHCF4C9c3v.B2XfFG'

const storeRefreshToken = (db, userId, refreshToken) =>
  db.refreshToken.create({
    data: {
      token: hashRefreshToken(refreshToken),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })

const reject = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

export const registerUser = async ({ name, email, password, acceptPrivacy }) => {
  email = normalizeEmail(email)
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    throw reject('El email ya está registrado', 409)
  }

  const hashedPassword = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      emailVerified: false,
      ...(acceptPrivacy ? { privacyAcceptedAt: new Date(), privacyPolicyVersion: PRIVACY_POLICY_VERSION } : {}),
    },
    select: { id: true, name: true, email: true, role: true, emailVerified: true },
  })

  const verificationToken = crypto.randomBytes(VERIFICATION_TOKEN_BYTES).toString('hex')
  const tokenHash = hashToken(verificationToken)

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS),
    },
  })

  // Fire-and-forget: el usuario ya está creado, no bloqueamos el response si SMTP falla
  sendVerificationEmail({ name: user.name, email: user.email }, verificationToken)
    .catch((err) => log.error({ err, context: 'register_verification' }, 'email.background_failed'))

  return {
    user,
    message: 'Cuenta creada. Revisa tu correo para verificar tu cuenta.',
  }
}

export const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })

  const validPassword = await bcrypt.compare(String(password ?? ''), user?.password || DUMMY_HASH)
  if (!user || !validPassword) {
    throw reject('Credenciales incorrectas', 401)
  }

  if (user.isActive === false) {
    throw reject('Tu cuenta está desactivada. Escríbenos si crees que es un error.', 403)
  }

  const safeUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    emailVerified: user.emailVerified,
  }
  const tokens = generateTokens(safeUser)
  await storeRefreshToken(prisma, user.id, tokens.refreshToken)

  return { user: safeUser, ...tokens }
}

export const refreshAccessToken = async (refreshToken) => {
  let decoded
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
  } catch {
    throw reject('Refresh token inválido', 401)
  }

  const tokenHash = hashRefreshToken(refreshToken)
  const stored = await prisma.refreshToken.findUnique({ where: { token: tokenHash } })

  if (!stored) {
    // JWT válido pero no está en BD: ya fue rotado hace tiempo o revocado. Si
    // alguien lo reutiliza puede ser un token robado → se revocan todas las sesiones.
    await prisma.refreshToken.deleteMany({ where: { userId: decoded.id } })
    log.warn({ userId: decoded.id }, 'auth.refresh_token_reuse_detected')
    throw reject('Sesión inválida, inicia sesión de nuevo', 401)
  }

  // Un token ya rotado sólo se acepta dentro del periodo de gracia: dos
  // pestañas que renuevan la sesión casi a la vez mandan el mismo token y la
  // segunda no debe cerrar todas las sesiones. Fuera de la gracia es reuso.
  // (Se revisa antes que la expiración porque al rotar se acorta expiresAt.)
  if (stored.replacedAt && Date.now() - stored.replacedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
    await prisma.refreshToken.deleteMany({ where: { userId: decoded.id } })
    log.warn({ userId: decoded.id }, 'auth.refresh_token_reuse_detected')
    throw reject('Sesión inválida, inicia sesión de nuevo', 401)
  }

  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => {})
    throw reject('Refresh token expirado o revocado', 401)
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, email: true, role: true, name: true, emailVerified: true, isActive: true },
  })

  if (!user || user.isActive === false) {
    await prisma.refreshToken.deleteMany({ where: { userId: decoded.id } })
    throw reject('Usuario no encontrado o desactivado', 401)
  }

  const { isActive, ...safeUser } = user
  const tokens = generateTokens(safeUser)

  // Rotación: el token viejo se marca como reemplazado (no se borra) para
  // reconocer el reuso. Su fila caduca pronto; cuando el job la purga, un
  // reuso cae en "no está en BD" y también revoca todo.
  // updateMany condicional: si dos refresh concurrentes lo marcan, sólo uno
  // afecta la fila y el otro sigue dentro de la gracia.
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.updateMany({
      where: { id: stored.id, replacedAt: null },
      data: { replacedAt: now, expiresAt: new Date(now.getTime() + ROTATED_TOKEN_RETENTION_MS) },
    })
    await storeRefreshToken(tx, user.id, tokens.refreshToken)
  })

  return { user: safeUser, ...tokens }
}

export const logoutUser = async (refreshToken) => {
  await prisma.refreshToken.deleteMany({ where: { token: hashRefreshToken(refreshToken) } })
}

export const verifyEmailToken = async (plainToken) => {
  if (!plainToken || typeof plainToken !== 'string') {
    throw reject('Token de verificación requerido', 400)
  }

  const tokenHash = hashToken(plainToken)

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  if (!record) {
    throw reject('Token de verificación inválido', 400)
  }

  if (record.usedAt) {
    throw reject('Este enlace de verificación ya fue utilizado', 400)
  }

  if (record.expiresAt < new Date()) {
    throw reject('El enlace de verificación ha expirado. Solicita uno nuevo.', 410)
  }

  // Idempotente: si ya está verificado, devolvemos éxito sin tocar nada
  if (record.user.emailVerified) {
    return {
      user: { id: record.user.id, name: record.user.name, email: record.user.email, emailVerified: true },
      alreadyVerified: true,
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Revocamos tokens pendientes del mismo usuario para evitar acumulación
    prisma.emailVerificationToken.deleteMany({
      where: { userId: record.userId, id: { not: record.id }, usedAt: null },
    }),
  ])

  return {
    user: {
      id: record.user.id,
      name: record.user.name,
      email: record.user.email,
      emailVerified: true,
    },
    alreadyVerified: false,
  }
}

export const resendVerificationEmail = async (email) => {
  const normalized = typeof email === 'string' ? email.toLowerCase().trim() : ''

  // Por seguridad, no revelamos si el email existe o no
  const user = await prisma.user.findUnique({ where: { email: normalized } })

  if (user && !user.emailVerified) {
    const verificationToken = crypto.randomBytes(VERIFICATION_TOKEN_BYTES).toString('hex')
    const tokenHash = hashToken(verificationToken)

    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS),
        },
      }),
    ])

    sendVerificationEmail({ name: user.name, email: user.email }, verificationToken)
      .catch((err) => log.error({ err, context: 'resend_verification' }, 'email.background_failed'))
  }

  // Siempre el mismo mensaje para no filtrar información
  return {
    message: 'Si el correo existe y no está verificado, enviaremos un nuevo enlace.',
  }
}

export const getVerificationStatus = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, emailVerifiedAt: true },
  })

  if (!user) {
    throw reject('Usuario no encontrado', 404)
  }

  return user
}

export const requestPasswordReset = async (email) => {
  const normalized = typeof email === 'string' ? email.toLowerCase().trim() : ''

  // Mismo principio que resend-verification: no filtramos si el correo existe o no.
  const user = await prisma.user.findUnique({ where: { email: normalized } })

  if (user) {
    // Código de 6 dígitos con leading zeros (000000–999999) — fácil de tipear en mobile
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const tokenHash = hashToken(code)

    await prisma.$transaction([
      // Revocamos todos los códigos pendientes del usuario para que sólo haya uno activo
      prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_CODE_EXPIRY_MS),
        },
      }),
    ])

    sendPasswordResetEmail({ name: user.name, email: user.email }, code)
      .catch((err) => log.error({ err, context: 'forgot_password' }, 'email.background_failed'))
  }

  // Mensaje neutro SIEMPRE — evita user-enumeration
  return {
    message: 'Si el correo existe, te enviamos un código de 6 dígitos para restablecer tu contraseña.',
    expiresInMinutes: 10,
  }
}

export const resetPasswordWithOtp = async ({ email, code, newPassword }) => {
  const normalized = typeof email === 'string' ? email.toLowerCase().trim() : ''

  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) {
    throw reject('La contraseña debe tener entre 8 y 72 caracteres', 400)
  }

  const tokenHash = hashToken(code)

  // 1) Buscamos el código activo (no usado, no expirado) que matchea el hash
  const record = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
      user: { email: normalized },
    },
    include: { user: true },
  })

  if (!record) {
    // 2) Si no matchea: intentamos bumpear el contador del ÚLTIMO token
    //    pendiente del usuario (si existe) para mitigar fuerza bruta sobre
    //    códigos válidos pero tipeados mal.
    await prisma.passwordResetToken.updateMany({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
        user: { email: normalized },
        attempts: { lt: RESET_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    }).catch(() => {})

    throw reject('Código inválido o expirado', 400)
  }

  // 3) Si ya superó el límite, descartamos el token y pedimos uno nuevo
  if (record.attempts >= RESET_MAX_ATTEMPTS) {
    await prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }).catch(() => {})
    throw reject('Demasiados intentos. Solicita un nuevo código.', 429)
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12)

  // 4) Marcamos el código como usado, limpiamos otros pendientes del usuario,
  //    cambiamos la password y revocamos TODAS las sesiones activas.
  //    Si la cuenta fue comprometida, el ladrón queda fuera automáticamente.
  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: record.userId, id: { not: record.id }, usedAt: null },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    }),
    prisma.refreshToken.deleteMany({
      where: { userId: record.userId },
    }),
  ])

  return {
    message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.',
  }
}