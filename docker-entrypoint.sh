#!/bin/sh
# Inicialização do container: aguarda o banco, aplica migrações, popula dados demo e sobe o servidor
set -e
echo "⏳ Aguardando PostgreSQL..."
until pg_isready -d "${DATABASE_URL%%\?*}" >/dev/null 2>&1; do sleep 1; done
echo "🗄️  Aplicando migrações..."
npx prisma migrate deploy
echo "🌱 Dados de demonstração (pulado se já existirem)..."
npm run db:seed
echo "🚀 GestãoPro em http://localhost:3000"
exec npx next start -p "${PORT:-3000}"
