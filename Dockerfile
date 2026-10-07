FROM node:22-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/prisma ./prisma/
RUN npx prisma generate

COPY backend/src ./src/
COPY backend/scripts ./scripts/

EXPOSE 3001

ENV NODE_ENV=production

# No correr como root dentro del contenedor.
RUN chown -R node:node /app
USER node

CMD ["npm", "run", "start:prod"]