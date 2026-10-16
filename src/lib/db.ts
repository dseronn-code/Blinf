import { PrismaClient } from '@prisma/client';

// Singleton do Prisma (evita múltiplas conexões no hot-reload do Next.js)
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: ['error'] });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export type Db = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
