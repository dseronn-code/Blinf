'use client';
import { Badge } from '@/components/ui/badge';

export const INTERVAL_LABEL: Record<string, string> = { MENSAL: 'Mensal', BIMESTRAL: 'Bimestral', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' };
export const INVOICE_LABEL: Record<string, string> = { NENHUMA: 'Sem nota', NFSE: 'NFS-e (serviços)', NFE: 'NF-e (produtos)' };
const STATUS_TONE: Record<string, [string, string]> = { ATIVO: ['Ativo', 'green'], SUSPENSO: ['Suspenso', 'yellow'], ENCERRADO: ['Encerrado', 'gray'] };
export const ContractStatus = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status]?.[1]}>{STATUS_TONE[status]?.[0] || status}</Badge>;
