import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return { rules: [{ userAgent: '*', allow: ['/loja/'], disallow: ['/api/', '/pagar/', '/'] }], sitemap: `${base}/sitemap.xml` };
}
