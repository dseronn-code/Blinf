import { prisma } from '@/lib/db';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { round2, addDays, randomDigits } from '@/lib/utils';

/** Importação de extrato OFX (formato SGML/XML dos bancos) */
export const POST = route('financeiro', 'edit', async ({ ctx, req }) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const bankAccountId = String(form.get('bankAccountId') || '');
  const acc = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, companyId: ctx.companyId } });
  if (!acc) fail(400, 'Selecione a conta bancária');
  if (!file) fail(400, 'Envie o arquivo OFX');
  const text = await file!.text();
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (!blocks.length) fail(400, 'Nenhuma transação encontrada no OFX');
  const tag = (b: string, t: string) => (b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1] || '').trim();
  let imported = 0, duplicated = 0;
  for (const b of blocks) {
    const fitId = tag(b, 'FITID');
    const amount = round2(Number(tag(b, 'TRNAMT').replace(',', '.')));
    const dt = tag(b, 'DTPOSTED');
    const date = new Date(`${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T12:00:00`);
    if (!amount || isNaN(date.getTime())) continue;
    if (fitId && (await prisma.bankTransaction.findFirst({ where: { bankAccountId: acc!.id, fitId } }))) { duplicated++; continue; }
    await prisma.bankTransaction.create({ data: { companyId: ctx.companyId, bankAccountId: acc!.id, date, amount, description: tag(b, 'MEMO') || tag(b, 'NAME') || 'Transação OFX', fitId: fitId || null, source: 'OFX', reconciled: false } });
    imported++;
  }
  return { imported, duplicated };
});

/** Gera um OFX de exemplo com transações compatíveis com títulos em aberto (para testar a conciliação) */
export const GET = route('financeiro', 'view', async ({ ctx }) => {
  const open = await prisma.financialEntry.findMany({ where: { companyId: ctx.companyId, status: 'ABERTO', dueDate: { gte: addDays(new Date(), -20), lte: addDays(new Date(), 10) } }, take: 8, orderBy: { dueDate: 'asc' } });
  const d = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, '') + '120000[-3:BRT]';
  const trs = open.map((e) => ({ type: e.type === 'RECEBER' ? 'CREDIT' : 'DEBIT', date: e.dueDate > new Date() ? new Date() : e.dueDate, amount: e.type === 'RECEBER' ? e.amount - e.paidAmount : -(e.amount - e.paidAmount), memo: `${e.type === 'RECEBER' ? 'PIX RECEBIDO' : 'PAGTO BOLETO'} ${(e.contactName || e.description).toUpperCase().slice(0, 30)}` }));
  trs.push({ type: 'DEBIT', date: new Date(), amount: -12.9, memo: 'TARIFA MANUTENCAO CONTA' }, { type: 'CREDIT', date: new Date(), amount: 3.47, memo: 'RENDIMENTO APLIC AUTOMATICA' });
  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${d(new Date())}<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0001<ACCTID>98765-4<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${d(addDays(new Date(), -20))}<DTEND>${d(new Date())}
${trs.map((t) => `<STMTTRN><TRNTYPE>${t.type}<DTPOSTED>${d(t.date)}<TRNAMT>${t.amount.toFixed(2)}<FITID>${randomDigits(12)}<MEMO>${t.memo}</STMTTRN>`).join('\n')}
</BANKTRANLIST><LEDGERBAL><BALAMT>0.00<DTASOF>${d(new Date())}</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  return fileResponse(ofx, 'application/x-ofx', `extrato-${new Date().toISOString().slice(0, 10)}.ofx`, false);
});
