import { prisma } from '../config/prisma.js'
import { sendContactNotification } from './email.service.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'contact' })

export const createContactMessage = async ({ name, email, subject, message, ip, userAgent, userId }) => {
  const saved = await prisma.contactMessage.create({
    data: {
      name,
      email,
      subject: subject || null,
      message,
      ip: ip || null,
      userAgent: userAgent || null,
      userId: userId || null,
    },
  })

  log.info({ messageId: saved.id, from: email }, 'contact.message_persisted')

  // Notificar al admin por email — no bloqueamos la respuesta si falla
  sendContactNotification({ name, email, subject, message }).catch((err) => {
    log.error({ err, messageId: saved.id }, 'contact.notification_failed')
  })

  return saved
}

export const getContactMessages = async ({ page = 1, limit = 20, isRead } = {}) => {
  const where = {}
  if (isRead !== undefined) where.isRead = isRead === 'true' || isRead === true

  const skip = (page - 1) * limit

  const [messages, total, unread] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contactMessage.count({ where }),
    prisma.contactMessage.count({ where: { isRead: false } }),
  ])

  return {
    messages,
    total,
    unread,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
  }
}

export const markContactMessageRead = async (id, isRead = true) => {
  try {
    return await prisma.contactMessage.update({
      where: { id },
      data: { isRead: Boolean(isRead) },
    })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Mensaje no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}

export const deleteContactMessage = async (id) => {
  try {
    return await prisma.contactMessage.delete({ where: { id } })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Mensaje no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}
