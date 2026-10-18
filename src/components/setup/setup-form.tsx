'use client';
import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Label } from '@/components/ui/input';
import { onlyDigits } from '@/lib/utils';

export type SetupValues = {
  company: { name: string; tradeName: string; cnpj: string; ie: string; im: string; taxRegime: 'SIMPLES' | 'PRESUMIDO' | 'REAL'; email: string; phone: string; zip: string; street: string; number: string; district: string; city: string; cityCode: string; uf: string };
  admin: { name: string; email: string; password: string; confirm: string };
};

const empty: SetupValues = {
  company: { name: '', tradeName: '', cnpj: '', ie: '', im: '', taxRegime: 'SIMPLES', email: '', phone: '', zip: '', street: '', number: '', district: '', city: '', cityCode: '', uf: '' },
  admin: { name: '', email: '', password: '', confirm: '' },
};

/** Formulário da empresa real + administrador (primeiro acesso e recomeço) */
export function SetupForm({ onSubmit, submitLabel, busy, extra }: { onSubmit: (v: SetupValues) => void; submitLabel: string; busy?: boolean; extra?: React.ReactNode }) {
  const [v, setV] = useState<SetupValues>(empty);
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'error'>('idle');
  const c = v.company;
  const setC = (patch: Partial<SetupValues['company']>) => setV((x) => ({ ...x, company: { ...x.company, ...patch } }));
  const setA = (patch: Partial<SetupValues['admin']>) => setV((x) => ({ ...x, admin: { ...x.admin, ...patch } }));
  // Preenche os dados pelo CNPJ (BrasilAPI — consulta feita pelo navegador)
  const findCnpj = async () => {
    const cnpj = onlyDigits(c.cnpj);
    if (cnpj.length !== 14) return;
    setLookup('busy');
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setC({
        name: d.razao_social || c.name, tradeName: d.nome_fantasia || c.tradeName, email: (d.email || c.email || '').toLowerCase(), phone: d.ddd_telefone_1 || c.phone,
        zip: d.cep || c.zip, street: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ') || c.street, number: d.numero || c.number, district: d.bairro || c.district,
        city: d.municipio || c.city, cityCode: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge) : c.cityCode, uf: d.uf || c.uf,
        taxRegime: d.opcao_pelo_simples ? 'SIMPLES' : c.taxRegime,
      });
      setLookup('idle');
    } catch {
      setLookup('error');
    }
  };
  const mismatch = v.admin.confirm && v.admin.password !== v.admin.confirm;
  const f = (label: string, el: React.ReactNode, cls = '') => <div className={cls}><Label className="mb-1 block text-xs">{label}</Label>{el}</div>;
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) onSubmit(v);
      }}
    >
      <section>
        <h3 className="mb-3 font-semibold">Sua empresa</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          {f('CNPJ *', <div className="flex gap-2"><Input required value={c.cnpj} onChange={(e) => setC({ cnpj: e.target.value })} onBlur={findCnpj} inputMode="numeric" placeholder="00.000.000/0000-00" /><Button type="button" variant="outline" onClick={findCnpj} title="Buscar dados pelo CNPJ">{lookup === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></div>, 'sm:col-span-3')}
          {f('Regime tributário *', <Select value={c.taxRegime} onChange={(e) => setC({ taxRegime: e.target.value as SetupValues['company']['taxRegime'] })}><option value="SIMPLES">Simples Nacional</option><option value="PRESUMIDO">Lucro Presumido</option><option value="REAL">Lucro Real</option></Select>, 'sm:col-span-3')}
          {lookup === 'error' && <p className="text-xs text-amber-700 sm:col-span-6">Não foi possível buscar o CNPJ automaticamente — preencha os dados abaixo.</p>}
          {f('Razão social *', <Input required value={c.name} onChange={(e) => setC({ name: e.target.value })} />, 'sm:col-span-4')}
          {f('Nome fantasia', <Input value={c.tradeName} onChange={(e) => setC({ tradeName: e.target.value })} />, 'sm:col-span-2')}
          {f('Inscrição estadual', <Input value={c.ie} onChange={(e) => setC({ ie: e.target.value })} placeholder="ou ISENTO" />, 'sm:col-span-2')}
          {f('Inscrição municipal', <Input value={c.im} onChange={(e) => setC({ im: e.target.value })} />, 'sm:col-span-2')}
          {f('Telefone', <Input value={c.phone} onChange={(e) => setC({ phone: e.target.value })} />, 'sm:col-span-2')}
          {f('CEP', <Input value={c.zip} onChange={(e) => setC({ zip: e.target.value })} />, 'sm:col-span-2')}
          {f('Endereço', <Input value={c.street} onChange={(e) => setC({ street: e.target.value })} />, 'sm:col-span-3')}
          {f('Número', <Input value={c.number} onChange={(e) => setC({ number: e.target.value })} />, 'sm:col-span-1')}
          {f('Bairro', <Input value={c.district} onChange={(e) => setC({ district: e.target.value })} />, 'sm:col-span-2')}
          {f('Cidade', <Input value={c.city} onChange={(e) => setC({ city: e.target.value })} />, 'sm:col-span-2')}
          {f('UF *', <Input required maxLength={2} value={c.uf} onChange={(e) => setC({ uf: e.target.value.toUpperCase() })} />, 'sm:col-span-1')}
          {f('Cód. IBGE', <Input value={c.cityCode} onChange={(e) => setC({ cityCode: e.target.value })} title="Código IBGE do município (necessário para emitir NF-e)" />, 'sm:col-span-1')}
          {f('E-mail da empresa', <Input type="email" value={c.email} onChange={(e) => setC({ email: e.target.value })} />, 'sm:col-span-6')}
        </div>
      </section>
      <section>
        <h3 className="mb-3 font-semibold">Seu acesso (administrador)</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f('Seu nome *', <Input required value={v.admin.name} onChange={(e) => setA({ name: e.target.value })} />)}
          {f('E-mail de acesso *', <Input required type="email" autoComplete="username" value={v.admin.email} onChange={(e) => setA({ email: e.target.value })} />)}
          {f('Senha * (mín. 8 caracteres)', <Input required type="password" autoComplete="new-password" minLength={8} value={v.admin.password} onChange={(e) => setA({ password: e.target.value })} />)}
          {f('Confirme a senha *', <Input required type="password" autoComplete="new-password" value={v.admin.confirm} onChange={(e) => setA({ confirm: e.target.value })} />)}
          {mismatch && <p className="text-xs text-red-600 sm:col-span-2">As senhas não conferem.</p>}
        </div>
      </section>
      {extra}
      <Button type="submit" className="w-full" disabled={busy || !!mismatch}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{submitLabel}</Button>
    </form>
  );
}
