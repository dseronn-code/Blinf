import { cn } from '@/lib/utils';

const tones: Record<string, string> = {
  green: 'bg-green-100 text-green-800 border-green-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  purple: 'bg-violet-100 text-violet-800 border-violet-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200',
  teal: 'bg-teal-100 text-teal-800 border-teal-200',
};

export function Badge({ tone = 'gray', className, children }: { tone?: keyof typeof tones | string; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone] || tones.gray, className)}>{children}</span>;
}

/** Mapeia status de domínio para cor e rótulo */
const STATUS: Record<string, [string, string]> = {
  ABERTO: ['Em aberto', 'yellow'], FATURADO: ['Faturado', 'blue'], SEPARADO: ['Separado', 'purple'], ENVIADO: ['Enviado', 'teal'], ENTREGUE: ['Entregue', 'green'], CANCELADO: ['Cancelado', 'red'],
  AUTORIZADA: ['Autorizada', 'green'], REJEITADA: ['Rejeitada', 'red'], CANCELADA: ['Cancelada', 'gray'], RASCUNHO: ['Rascunho', 'gray'],
  PAGO: ['Pago', 'green'], PARCIAL: ['Parcial', 'blue'], VENCIDO: ['Vencido', 'red'],
  ENVIADA: ['Enviada', 'blue'], APROVADA: ['Aprovada', 'green'], RECUSADA: ['Recusada', 'red'], CONVERTIDA: ['Convertida', 'purple'], EXPIRADA: ['Expirada', 'gray'],
  RECEBIDO: ['Recebido', 'green'], EM_CONFERENCIA: ['Em conferência', 'purple'],
  PLANEJADA: ['Planejada', 'gray'], EM_PRODUCAO: ['Em produção', 'blue'], FINALIZADA: ['Finalizada', 'green'],
  ABERTA: ['Aberta', 'yellow'], ORCAMENTO: ['Orçamento', 'gray'], EM_EXECUCAO: ['Em execução', 'blue'], AGUARDANDO_PECA: ['Aguardando peça', 'orange'], CONCLUIDA: ['Concluída', 'teal'], FATURADA: ['Faturada', 'green'],
  PENDENTE: ['Pendente', 'yellow'], LIBERADA: ['Liberada', 'blue'], PAGA: ['Paga', 'green'],
  ETIQUETA_GERADA: ['Etiqueta gerada', 'blue'], POSTADO: ['Postado', 'purple'], EM_TRANSITO: ['Em trânsito', 'teal'], SAIU_PARA_ENTREGA: ['Saiu p/ entrega', 'orange'],
  CONECTADO: ['Conectado', 'green'], DESCONECTADO: ['Desconectado', 'gray'], ERRO: ['Erro', 'red'],
  ATIVO: ['Ativo', 'green'], PAUSADO: ['Pausado', 'gray'], SEM_ESTOQUE: ['Sem estoque', 'red'], ENCERRADO: ['Encerrado', 'gray'],
  OK: ['OK', 'green'], BAIXO: ['Baixo', 'orange'], RUPTURA: ['Ruptura', 'red'], EXCESSO: ['Excesso', 'purple'],
  LANCADA: ['Lançada', 'green'], IGNORADA: ['Ignorada', 'gray'], ABERTO_CAIXA: ['Aberto', 'green'], FECHADO: ['Fechado', 'gray'],
};
export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] || [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}
export const statusLabel = (s: string) => STATUS[s]?.[0] || s;
