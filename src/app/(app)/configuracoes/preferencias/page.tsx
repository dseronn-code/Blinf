'use client';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useApi, useAction } from '@/lib/api';
import { PageHeader, Field } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function Preferences() {
  const { data } = useApi<any>('/api/company');
  const act = useAction();
  const [mode, setMode] = useState('SEPARADO');
  const [org, setOrg] = useState('');
  useEffect(() => { if (data) { setMode(data.organization.stockMode); setOrg(data.organization.name); } }, [data]);
  return (
    <div>
      <PageHeader title="Preferências da conta" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Conta</CardTitle></CardHeader><CardContent><Field label="Nome da organização"><Input value={org} onChange={(e) => setOrg(e.target.value)} /></Field></CardContent></Card>
        <Card><CardHeader><CardTitle>Estoque em multiempresa</CardTitle></CardHeader><CardContent className="space-y-2">
          {[['SEPARADO', 'Estoque separado por empresa', 'Cada CNPJ vende e sincroniza com os canais apenas o saldo dos próprios depósitos.'], ['UNIFICADO', 'Estoque unificado', 'O saldo disponível soma os depósitos de todas as empresas da conta (ex.: loja e CD com CNPJs diferentes).']].map(([v, l, d]) => (
            <button key={v} onClick={() => setMode(v)} className={cn('block w-full rounded-lg border p-3 text-left', mode === v && 'border-primary ring-1 ring-primary')}><div className="font-medium">{l}</div><div className="text-xs text-muted-foreground">{d}</div></button>
          ))}
        </CardContent></Card>
      </div>
      <Button className="mt-4" onClick={() => act('PUT', '/api/company', { stockMode: mode, organizationName: org }, 'Preferências salvas')}><Save /> Salvar</Button>
    </div>
  );
}
