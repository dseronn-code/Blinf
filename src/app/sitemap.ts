import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Sitemap das lojas virtuais publicadas */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const stores = await prisma.store.findMany({ where: { published: true }, select: { slug: true, customDomain: true, updatedAt: true } }).catch(() => []);
  return stores.map((s) => ({ url: s.customDomain ? `https://${s.customDomain}/` : `${base}/loja/${s.slug}`, lastModified: s.updatedAt, changeFrequency: 'daily', priority: 1 }));
}
