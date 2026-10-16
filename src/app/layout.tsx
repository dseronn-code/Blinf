import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { PwaManager } from '@/components/layout/pwa';

export const metadata: Metadata = {
  title: { default: 'GestãoPro — Gestão online para o seu negócio', template: '%s | GestãoPro' },
  description: 'ERP online para PMEs: vendas, estoque, notas fiscais, financeiro e multicanal (ambiente de demonstração).',
  // App instalável (PWA)
  applicationName: 'GestãoPro',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GestãoPro', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#16a34a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          {children}
          <PwaManager />
        </Providers>
      </body>
    </html>
  );
}
