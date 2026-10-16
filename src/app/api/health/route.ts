import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Health check (Docker/Kubernetes/monitoramento): banco + fila */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [pending, failed] = await Promise.all([prisma.job.count({ where: { status: 'PENDENTE' } }), prisma.job.count({ where: { status: 'ERRO' } })]);
    return NextResponse.json({ status: 'ok', database: 'ok', latencyMs: Date.now() - started, jobs: { pending, failed }, worker: process.env.DISABLE_WORKER === 'true' ? 'desativado' : 'ativo', uptime: Math.round(process.uptime()), version: process.env.npm_package_version || '1.0.0' });
  } catch (e) {
    return NextResponse.json({ status: 'error', database: 'indisponível', error: (e as Error).message }, { status: 503 });
  }
}
