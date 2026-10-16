import { PrismaClient } from '@prisma/client';
import { moneyMiddleware } from './moneyGuard';

// Singleton do Prisma (evita múltiplas conexões no hot-reload do Next.js)
const g = globalThis as unknown as { prisma?: PrismaClient };
function create() {
  const base = new PrismaClient({ log: ['error'] });
  // Todos os valores monetários são gravados arredondados em centavos (vale também dentro de $transaction)
  const ext = base.$extends({
    query: { $allModels: { $allOperations: ({ operation, args, query }) => moneyMiddleware({ action: operation, args }, (p) => query(p.args)) } },
  });
  // A extensão só altera o comportamento de escrita; a API e os tipos são os do PrismaClient
  return ext as unknown as PrismaClient;
}
export const prisma = g.prisma ?? create();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export type Db = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
