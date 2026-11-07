FROM node:22-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# pnpm vía corepack, en la versión fijada en backend/package.json ("packageManager").
# Se descarga en el build (no al arrancar) y queda dentro de la imagen.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable

WORKDIR /app

COPY backend/package.json backend/pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile --prod && chmod -R a+rX "$COREPACK_HOME"

COPY backend/prisma ./prisma/
RUN pnpm exec prisma generate

COPY backend/src ./src/
COPY backend/scripts ./scripts/

EXPOSE 3001

ENV NODE_ENV=production

# No correr como root dentro del contenedor.
RUN chown -R node:node /app
USER node

CMD ["pnpm", "run", "start:prod"]
