import * as ContactService from '../services/contact.service.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'contact' })

export const submitContactMessage = async (req, res, next) => {
  try {
    const userId = req.user?.id || null

    const saved = await ContactService.createContactMessage({
      name:      req.body.name,
      email:     req.body.email,
      subject:   req.body.subject,
      message:   req.body.message,
      ip:        req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null,
      userId,
    })

    log.info({ messageId: saved.id, userId }, 'contact.submitted')

    res.status(201).json({
      message: 'Mensaje enviado. Te responderemos pronto.',
      id: saved.id,
    })
  } catch (err) {
    next(err)
  }
}

export const listContactMessages = async (req, res, next) => {
  try {
    const isRead = req.query.isRead
    const result = await ContactService.getContactMessages({
      page:  req.query.page  || 1,
      limit: req.query.limit || 20,
      isRead,
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const readContactMessage = async (req, res, next) => {
  try {
    const message = await ContactService.markContactMessageRead(
      req.params.id,
      req.body?.isRead !== undefined ? req.body.isRead : true,
    )
    res.json(message)
  } catch (err) {
    next(err)
  }
}

export const removeContactMessage = async (req, res, next) => {
  try {
    const result = await ContactService.deleteContactMessage(req.params.id)
    res.json({ message: 'Mensaje eliminado', id: result.id })
  } catch (err) {
    next(err)
  }
}
