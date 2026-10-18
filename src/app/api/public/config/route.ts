import { NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/demo';
import { setupNeeded } from '@/server/services/setup';

/** Configuração pública usada pela tela de login (modo demonstração / primeiro acesso) */
export async function GET() {
  return NextResponse.json({ demo: isDemoMode(), setupNeeded: await setupNeeded().catch(() => false) }, { headers: { 'Cache-Control': 'no-store' } });
}
