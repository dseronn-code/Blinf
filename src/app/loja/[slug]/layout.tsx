import type { Metadata } from 'next';
import { prisma } from '@/lib/db';

type P = { params: Promise<{ slug: string }> };

/** SEO da loja virtual: título, descrição, Open Graph e dados estruturados */
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const store = await prisma.store.findUnique({ where: { slug } }).catch(() => null);
  if (!store) return { title: 'Loja não encontrada' };
  const title = store.seoTitle || `${store.name} — ${store.bannerTitle}`;
  const description = store.seoDescription || store.bannerSubtitle || store.aboutText || undefined;
  return {
    title,
    description,
    alternates: store.customDomain ? { canonical: `https://${store.customDomain}/` } : undefined,
    openGraph: { title, description, type: 'website', siteName: store.name, images: store.bannerImage ? [store.bannerImage] : undefined },
    robots: store.published ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await prisma.store.findUnique({ where: { slug } }).catch(() => null);
  const company = store ? await prisma.company.findUnique({ where: { id: store.companyId }, select: { name: true, phone: true, email: true, city: true, uf: true } }) : null;
  const ld = store && company ? { '@context': 'https://schema.org', '@type': 'Store', name: store.name, legalName: company.name, telephone: company.phone, email: company.email, address: { '@type': 'PostalAddress', addressLocality: company.city, addressRegion: company.uf, addressCountry: 'BR' } } : null;
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />}
      {children}
    </>
  );
}
