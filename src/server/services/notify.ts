import { prisma } from '@/lib/db';

/** Cria notificação para a empresa (sino do topo). Evita duplicar alertas idênticos não lidos nas últimas 24h. */
export async function notify(companyId: string, title: string, message: string, opts: { level?: string; link?: string } = {}) {
  const dup = await prisma.notification.findFirst({ where: { companyId, title, message, read: false, createdAt: { gt: new Date(Date.now() - 86400000) } } });
  if (dup) return;
  await prisma.notification.create({ data: { companyId, title, message, level: opts.level || 'info', link: opts.link || null } });
}

export async function audit(companyId: string, userId: string | null, action: string, entity: string, entityId?: string | null, details?: string) {
  await prisma.auditLog.create({ data: { companyId, userId, action, entity, entityId: entityId || null, details } }).catch(() => {});
}
