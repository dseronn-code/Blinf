#!/bin/sh
# Inicialização do container: aguarda o banco, aplica migrações, sobe o servidor e
# carrega os dados de demonstração (em segundo plano, só no primeiro start).
set -e
# No Railway, o endereço público vem de RAILWAY_PUBLIC_DOMAIN (Settings → Networking → Generate Domain)
if [ -z "$NEXTAUTH_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then export NEXTAUTH_URL="https://$RAILWAY_PUBLIC_DOMAIN"; fi
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
if [ -z "$DATABASE_URL" ]; then
  echo "❌ A variável DATABASE_URL está vazia."
  echo "   No Railway: crie o banco (+ Create → Database → PostgreSQL) e, no serviço do GestãoPro,"
  echo "   aba Variables, adicione DATABASE_URL = \${{Postgres.DATABASE_URL}} (botão Add Reference)."
  exit 1
fi
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#')
echo "⏳ Aguardando PostgreSQL em $DB_HOST..."
tries=0
until pg_isready -d "${DATABASE_URL%%\?*}" >/dev/null 2>&1; do
  tries=$((tries+1))
  if [ $((tries % 15)) -eq 0 ]; then
    echo "   ainda aguardando $DB_HOST ($tries s): $(pg_isready -d "${DATABASE_URL%%\?*}" 2>&1)"
  fi
  if [ $tries -ge 180 ]; then
    echo "❌ Não foi possível conectar ao banco em 3 minutos. Confira se o serviço Postgres está ativo"
    echo "   e se DATABASE_URL aponta para ele (no Railway: \${{Postgres.DATABASE_URL}})."
    exit 1
  fi
  sleep 1
done
echo "✅ Banco de dados conectado"
echo "🗄️  Aplicando migrações..."
npx prisma migrate deploy
if [ "${SEED_DEMO:-true}" = "true" ]; then
  # O seed só cria dados se o banco estiver vazio; roda em paralelo para o servidor
  # responder logo (plataformas como o Railway exigem resposta em poucos minutos)
  echo "🌱 Dados de demonstração em segundo plano (pulado se já existirem; ~10 min na primeira vez)..."
  (npm run db:seed > /tmp/seed.log 2>&1 && echo "✅ Dados de demonstração prontos" || { echo "⚠️  Falha no seed:"; tail -20 /tmp/seed.log; }) &
fi
echo "🚀 GestãoPro na porta ${PORT:-3000}${NEXTAUTH_URL:+ — $NEXTAUTH_URL}"
exec npx next start -p "${PORT:-3000}"
