FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/prisma ./prisma/
RUN npx prisma generate

COPY backend/src ./src/

EXPOSE 3001

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]