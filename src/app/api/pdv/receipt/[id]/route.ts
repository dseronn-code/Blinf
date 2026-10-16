import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { fmtDoc as formatDoc } from '@/lib/utils';

const W = 48; // colunas de uma bobina 80 mm (fonte A)
const PAY: Record<string, string> = { DINHEIRO: 'Dinheiro', PIX: 'Pix', CARTAO_CREDITO: 'Cartão crédito', CARTAO_DEBITO: 'Cartão débito', BOLETO: 'Boleto', CREDIARIO: 'Crediário' };
const center = (s: string) => s.slice(0, W).padStart(Math.floor((W + Math.min(s.length, W)) / 2)).padEnd(W);
const lr = (l: string, r: string) => `${l.slice(0, W - r.length - 1).padEnd(W - r.length)}${r}`;
const m = (v: number) => v.toFixed(2).replace('.', ',');
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Cupom da venda para impressora térmica.
 * ?format=text (padrão) — texto puro 48 colunas (impressão via navegador/driver)
 * ?format=escpos — comandos ESC/POS (envio direto à impressora: Epson, Elgin, Bematech...)
 */
export const GET = route('pdv', 'view', async ({ ctx, params, query }) => {
  const o = await prisma.salesOrder.findFirst({ where: { id: params.id, companyId: { in: ctx.companyIds } }, include: { items: true, customer: true } });
  if (!o) fail(404, 'Venda não encontrada');
  const [company, inv, cash] = await Promise.all([
    prisma.company.findUnique({ where: { id: o!.companyId } }),
    prisma.invoice.findFirst({ where: { salesOrderId: o!.id, model: 'NFCE', status: { in: ['AUTORIZADA', 'CONTINGENCIA'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.cashMovement.findMany({ where: { orderId: o!.id, type: 'VENDA' } }),
  ]);
  const c = company!;
  const L: string[] = [];
  const hr = '-'.repeat(W);
  L.push(center(c.tradeName || c.name), center(c.name), center(`CNPJ ${formatDoc(c.cnpj)}  IE ${c.ie || ''}`), center(`${c.street || ''}, ${c.number || ''} - ${c.city || ''}/${c.uf}`), hr);
  L.push(center(inv ? 'DANFE NFC-e - Documento Auxiliar' : 'CUPOM NAO FISCAL'), center(inv ? 'da Nota Fiscal de Consumidor Eletronica' : `Venda nº ${o!.number}`), hr);
  L.push('# Codigo   Descricao'.padEnd(W), lr('  Qtd x Unit.', 'Total'));
  o!.items.forEach((it, i) => {
    L.push(`${String(i + 1).padStart(3, '0')} ${(it.sku || '').padEnd(9).slice(0, 9)} ${it.description}`.slice(0, W));
    L.push(lr(`    ${String(it.quantity).replace('.', ',')} UN x ${m(it.unitPrice)}`, m(it.total)));
  });
  L.push(hr, lr(`Qtd. total de itens`, String(o!.items.length)), lr('Subtotal R$', m(o!.subtotal)));
  if (o!.discount) L.push(lr('Desconto R$', `-${m(o!.discount)}`));
  L.push(lr('VALOR A PAGAR R$', m(o!.total)), lr('FORMA DE PAGAMENTO', 'VALOR PAGO'));
  const pays = cash.length ? cash : [{ method: o!.paymentMethod, amount: o!.total }];
  for (const p of pays) L.push(lr(PAY[p.method] || p.method, m(p.amount)));
  const paid = pays.reduce((a, p) => a + p.amount, 0);
  if (paid > o!.total + 0.001) L.push(lr('Troco R$', m(paid - o!.total)));
  L.push(hr);
  if (inv) {
    L.push(center(inv.contingency ? 'EMITIDA EM CONTINGENCIA' : 'Consulte pela chave de acesso em'), center('www.nfce.fazenda.sp.gov.br/consulta'));
    L.push(center((inv.accessKey || '').replace(/(\d{4})/g, '$1 ').trim().slice(0, W)));
    L.push(center(o!.customer.document ? `CONSUMIDOR CPF/CNPJ ${formatDoc(o!.customer.document)}` : 'CONSUMIDOR NAO IDENTIFICADO'));
    L.push(center(`NFC-e nº ${inv.number}  Serie ${inv.series}  ${inv.issueDate.toLocaleString('pt-BR')}`));
    if (inv.protocol) L.push(center(`Protocolo ${inv.protocol}`));
    L.push(center(`Tributos aprox.: R$ ${m(inv.icmsValue + inv.pisValue + inv.cofinsValue + inv.ipiValue)} (Lei 12.741)`));
    if (c.sefazMode !== 'ASSINADO' || !inv.signed) L.push(center('AMBIENTE DE DEMONSTRACAO - SEM VALOR FISCAL'));
  } else L.push(center(o!.date.toLocaleString('pt-BR')), center('NAO E DOCUMENTO FISCAL'));
  L.push(hr, center('Obrigado pela preferencia!'), '', '');
  const text = strip(L.join('\n'));

  if (query.get('format') === 'escpos') {
    // ESC @ (init) + ESC a 0 + texto CP850 simplificado + QR (GS ( k) + corte parcial (GS V 66 0)
    const parts: Buffer[] = [Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x02])];
    parts.push(Buffer.from(text, 'latin1'));
    if (inv?.accessKey) {
      const data = Buffer.from(`https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${inv.accessKey}|2|2|${c.cscId || '1'}`, 'latin1');
      const len = data.length + 3;
      parts.push(Buffer.from([0x1b, 0x61, 0x01]));
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])); // modelo 2
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05])); // tamanho do módulo
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]), data);
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, 0x0a, 0x1b, 0x61, 0x00]));
    }
    parts.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]));
    return fileResponse(Buffer.concat(parts), 'application/octet-stream', `cupom-${o!.number}.bin`, false);
  }
  return fileResponse(text, 'text/plain; charset=utf-8', `cupom-${o!.number}.txt`);
});
