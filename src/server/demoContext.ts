import { prisma } from '@/lib/db';

/**
 * Rotas públicas: descobre se a empresa/loja pertence à organização de demonstração.
 * A rota chama `enterDemo(await ...)` no PRÓPRIO corpo (o contexto vale para o resto dela).
 */
export async function orgIsDemo(companyId: string | null | undefined) {
  if (!companyId) return false;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { organization: { select: { demo: true } } } });
  return !!c?.organization.demo;
}

export async function storeIsDemo(slug: string) {
  const s = await prisma.store.findUnique({ where: { slug }, select: { companyId: true } });
  return orgIsDemo(s?.companyId);
}
