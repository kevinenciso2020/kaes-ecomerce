import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import {
  submitContactMessage,
} from '../controllers/contact.controller.js'
import { createContactMessage } from '../validators/contact.validator.js'
import { contactLimiter } from '../middleware/rateLimit.middleware.js'

const router = Router()

// Público: cualquier usuario puede enviar un mensaje.
// Rate limit por IP+email para evitar spam.
// Si hay sesión iniciada (opcional), se asocia el mensaje al userId.
router.post('/', contactLimiter, validate(createContactMessage), submitContactMessage)

export default router
