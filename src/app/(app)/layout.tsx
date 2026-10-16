import { Suspense } from 'react';
import { AppShell } from '@/components/layout/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
