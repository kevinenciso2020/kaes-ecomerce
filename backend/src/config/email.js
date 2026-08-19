import nodemailer from 'nodemailer'
import { logger } from './logger.js'

const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const secure = process.env.SMTP_SECURE === 'true'

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export const emailTransporter = createTransporter()

export const verifyEmailConfig = async () => {
  try {
    await emailTransporter.verify()
    logger.info('email.transporter_verified')
    return true
  } catch (error) {
    logger.error({ err: error }, 'email.transporter_verify_failed')
    return false
  }
}
