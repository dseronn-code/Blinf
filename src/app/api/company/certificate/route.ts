import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { onlyDigits } from '@/lib/utils';
import { readCertificate, generateDemoCertificate } from '@/server/services/cert';
import { updateFiscalSettings, fiscalProviderOf } from '@/server/services/fiscal';
import { isDemoMode, requireRealOrDemo } from '@/lib/demo';

/**
 * Instalação do certificado digital A1 (.pfx/.p12).
 * O arquivo é aberto de verdade (senha, titular, validade, série) e passa a ser
 * usado para ASSINAR o XML das notas. Também é possível gerar um certificado
 * autoassinado de demonstração.
 */
export const POST = route('fiscal', 'edit', async ({ ctx, req }) => {
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  const form = await req.formData();
  let pfx: Buffer;
  let password = String(form.get('password') || '');
  if (form.get('demo') === '1') {
    // Certificado autoassinado não é aceito por nenhuma SEFAZ: só no modo demonstração
    requireRealOrDemo('Certificado de demonstração', 'Envie o seu certificado digital A1 (.pfx ou .p12) emitido por uma autoridade certificadora ICP-Brasil.');
    password = 'demo1234';
    pfx = generateDemoCertificate(company!.name, onlyDigits(company!.cnpj), password);
  } else {
    const file = form.get('file') as File | null;
    if (!file) fail(400, 'Selecione o arquivo do certificado (.pfx ou .p12)');
    if (!/\.(pfx|p12)$/i.test(file!.name)) fail(400, 'Formato inválido: envie um certificado A1 (.pfx ou .p12)');
    pfx = Buffer.from(await file!.arrayBuffer());
  }
  let info;
  try {
    info = readCertificate(pfx, password);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  if (info!.notAfter < new Date()) fail(400, `Certificado vencido em ${info!.notAfter.toLocaleDateString('pt-BR')}`);
  const warning = info!.cnpj && info!.cnpj !== onlyDigits(company!.cnpj) ? `Atenção: o CNPJ do certificado (${info!.cnpj}) difere do CNPJ da empresa.` : null;
  const updated = await prisma.company.update({
    where: { id: ctx.companyId },
    data: { certPfx: new Uint8Array(pfx), certPassword: password, certName: info!.cn, certIssuer: info!.issuer, certSerial: info!.serial, certValidUntil: info!.notAfter, certUploadedAt: new Date(), sefazMode: company!.sefazMode === 'CONTINGENCIA' ? 'CONTINGENCIA' : 'ASSINADO' },
    select: { certName: true, certIssuer: true, certSerial: true, certValidUntil: true },
  });
  return { ...updated, warning };
});

export const DELETE = route('fiscal', 'edit', async ({ ctx }) => {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { fiscalProvider: true } });
  // Sem certificado não há comunicação direta com a SEFAZ: volta ao modo simulado
  return prisma.company.update({ where: { id: ctx.companyId }, data: { certName: null, certIssuer: null, certValidUntil: null, certUploadedAt: null, certPfx: null, certPassword: null, certSerial: null, sefazMode: 'SIMULADO', ...(c?.fiscalProvider === 'SEFAZ' ? { fiscalProvider: 'SIMULADO' } : {}) }, select: { id: true } });
});

/** Modo da SEFAZ: normal ou contingência (NFC-e offline); também salva o modo de emissão/ambiente */
export const PUT = route('fiscal', 'edit', async ({ ctx, body }) => {
  // Modo de emissão (SIMULADO | SEFAZ | FOCUS_NFE), ambiente e CSC da NFC-e
  if (body?.contingency === undefined) return updateFiscalSettings(ctx.companyId, body || {});
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  // Contingência offline da NFC-e só existe na emissão direta pela SEFAZ (com certificado A1)
  if (body?.contingency && !isDemoMode() && (!c || fiscalProviderOf(c) !== 'SEFAZ' || !c.certPfx)) fail(400, 'A contingência offline da NFC-e só se aplica à emissão SEFAZ direta com certificado A1 instalado (Notas fiscais → Certificado).');
  const mode = body?.contingency ? 'CONTINGENCIA' : c?.certPfx ? 'ASSINADO' : 'SIMULADO';
  return prisma.company.update({ where: { id: ctx.companyId }, data: { sefazMode: mode }, select: { sefazMode: true } });
});
