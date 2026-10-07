// Se importa ANTES que cualquier otro módulo (ver server.js) para que Sentry
// pueda instrumentar express/http automáticamente.
import 'dotenv/config'
import { initSentry } from './config/sentry.js'

export const sentryEnabled = initSentry()
