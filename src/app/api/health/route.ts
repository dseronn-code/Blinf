import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Health check (Docker/Kubernetes/monitoramento): banco + fila */
// CORS liberado: o app Android verifica o endereço do servidor antes de abrir o ERP
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
}

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [pending, failed] = await Promise.all([prisma.job.count({ where: { status: 'PENDENTE' } }), prisma.job.count({ where: { status: 'ERRO' } })]);
    return NextResponse.json({ status: 'ok', app: 'gestaopro', database: 'ok', latencyMs: Date.now() - started, jobs: { pending, failed }, worker: process.env.DISABLE_WORKER === 'true' ? 'desativado' : 'ativo', uptime: Math.round(process.uptime()), version: process.env.npm_package_version || '1.0.0' }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ status: 'error', database: 'indisponível', error: (e as Error).message }, { status: 503, headers: CORS });
  }
}
