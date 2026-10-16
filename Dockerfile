# GestãoPro — imagem única (build + runtime) para ambiente local/demo
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependências (o postinstall gera o Prisma Client, por isso o schema vem antes)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Código-fonte e build de produção
COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
