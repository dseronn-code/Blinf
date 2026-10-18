'use client';
import { Download, DatabaseBackup } from 'lucide-react';
import { PageHeader } from '@/components/common/page';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { openFile } from '@/lib/api';

/** Dados do sistema: backup */
export default function DataPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Dados e backup" description="Cópia de segurança dos dados." />
      <Card className="mb-6 p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold"><DatabaseBackup className="h-5 w-5" /> Backup</div>
        <p className="mb-3 text-sm text-muted-foreground">Baixa uma cópia completa de todos os dados (cadastros, pedidos, notas, financeiro, configurações) em um arquivo compactado. Contém dados sensíveis — guarde em local seguro. No Railway, ative também os backups automáticos do banco (serviço Postgres → Backups).</p>
        <Button variant="outline" onClick={() => openFile('/api/system/backup')}><Download className="mr-1 h-4 w-4" /> Baixar backup agora</Button>
      </Card>
    </div>
  );
}
