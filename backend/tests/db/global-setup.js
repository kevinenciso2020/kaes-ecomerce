import { execSync } from 'node:child_process'

export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL es requerido para npm run test:db')
  if (/neon\.tech|railway|amazonaws/.test(url)) {
    throw new Error('TEST_DATABASE_URL parece una base remota/productiva. Usa una base local desechable.')
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  })
}
