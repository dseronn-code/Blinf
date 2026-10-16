import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'GestãoPro — Gestão online para o seu negócio', template: '%s | GestãoPro' },
  description: 'ERP online para PMEs: vendas, estoque, notas fiscais, financeiro e multicanal (ambiente de demonstração).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
