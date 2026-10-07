FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
COPY scripts ./scripts/

EXPOSE 3001

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]