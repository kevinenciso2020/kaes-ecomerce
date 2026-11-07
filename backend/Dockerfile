FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# pnpm vía corepack, en la versión fijada en package.json ("packageManager").
# Se descarga en el build (no al arrancar) y queda dentro de la imagen.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile --prod

COPY prisma ./prisma/
RUN pnpm exec prisma generate

COPY src ./src/
COPY scripts ./scripts/

EXPOSE 3001

ENV NODE_ENV=production

CMD ["pnpm", "run", "start:prod"]
