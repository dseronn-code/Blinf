import { route, fileResponse } from '@/server/http';
import { sampleSupplierXml } from '@/server/services/purchases';

// Gera um XML de NF-e de fornecedor (simulação) para testar a importação
export const GET = route('compras', 'view', async ({ ctx }) => fileResponse(await sampleSupplierXml(ctx), 'application/xml', `nfe-fornecedor-${Date.now()}.xml`, false));
