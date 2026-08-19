import 'dotenv/config'
import app from './app.js'
import { prisma } from './config/prisma.js'
import { logger } from './config/logger.js'

const PORT = Number.parseInt(process.env.PORT, 10) || 8000

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'server.started')
})

const shutdown = (signal) => {
  logger.warn({ signal }, 'server.shutdown_initiated')
  server.close(async () => {
    logger.info('server.connections_closed')
    try {
      await prisma.$disconnect()
      logger.info('server.prisma_disconnected')
    } catch (err) {
      logger.error({ err }, 'server.prisma_disconnect_failed')
    }
    process.exit(0)
  })

  setTimeout(() => {
    logger.error('server.shutdown_forced')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'process.unhandled_rejection')
})

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'process.uncaught_exception')
  shutdown('uncaughtException')
})
