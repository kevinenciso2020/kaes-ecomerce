import 'dotenv/config'
import app from './app.js'
import { prisma } from './config/prisma.js'

const PORT = process.env.PORT || 8000

const server = app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
  console.log(`📦 Entorno: ${process.env.NODE_ENV}`)
})

process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM recibido, cerrando servidor...')
  server.close(async () => {
    console.log('✅ Conexiones cerradas')
    try {
      await prisma.$disconnect()
      console.log('✅ Prisma desconectado')
    } catch (err) {
      console.error('❌ Error al desconectar Prisma:', err.message)
    }
    process.exit(0)
  })
})