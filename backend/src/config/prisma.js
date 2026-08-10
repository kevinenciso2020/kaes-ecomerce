import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

// Construye la URL de conexión preservando los query params existentes
// (Neon ya añade sslmode=require&channel_binding=require). Si concatena '?'
// cuando la URL ya tiene query, la URL queda malformada.
const buildDatabaseUrl = (rawUrl) => {
  if (!rawUrl) return rawUrl
  const params = 'connection_limit=5&connect_timeout=30&pool_timeout=30&statement_timeout=10000'
  const separator = rawUrl.includes('?') ? '&' : '?'
  return `${rawUrl}${separator}${params}`
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    datasources: {
      db: {
        url: buildDatabaseUrl(process.env.DATABASE_URL),
      },
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}