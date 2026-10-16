/**
 * Geração de PDFs (pdf-lib + bwip-js): DANFE (NF-e), DANFE NFC-e, NFS-e,
 * boleto, etiquetas de produto/estoque, etiqueta de envio 10x15 e
 * relatórios tabulares.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import bwipjs from 'bwip-js/node';
import type { Company, Invoice, InvoiceItem, FinancialEntry, BankAccount, Shipment, SalesOrder } from '@prisma/client';
import { formatAccessKey } from '@/lib/br';
import { fmtDoc, fmtCep, fmtDate, fmtDateTime, money, num } from '@/lib/utils';

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** Remove caracteres não suportados pela fonte padrão (WinAnsi) */
export function safe(s: unknown) {
  return String(s ?? '')
    .replace(/→/g, '->')
    .split('')
    .map((ch) => (ch.charCodeAt(0) <= 255 || WIN_ANSI_EXTRA.includes(ch) ? ch : '?'))
    .join('')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
}

async function barcode(doc: PDFDocument, bcid: string, text: string, opts: Record<string, unknown> = {}): Promise<PDFImage | null> {
  try {
    const merged: Record<string, unknown> = { bcid, text, scale: 3, includetext: false, ...(bcid === 'qrcode' || bcid === 'datamatrix' ? {} : { height: 10 }), ...opts };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const png = await bwipjs.toBuffer(merged as never);
    return doc.embedPng(png);
  } catch {
    return null;
  }
}

type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont };
function text(c: Ctx, s: unknown, x: number, y: number, size = 8, b = false, color = rgb(0, 0, 0)) {
  c.page.drawText(safe(s), { x, y, size, font: b ? c.bold : c.font, color });
}
function fit(font: PDFFont, s: string, size: number, maxW: number) {
  let t = safe(s);
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -1);
  return t;
}
function box(c: Ctx, x: number, y: number, w: number, h: number, label?: string, value?: unknown, size = 8, bold = false) {
  c.page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
  if (label) text(c, label.toUpperCase(), x + 2, y + h - 7, 5.5);
  if (value != null) c.page.drawText(fit(bold ? c.bold : c.font, String(value), size, w - 4), { x: x + 2, y: y + 3, size, font: bold ? c.bold : c.font });
}

async function newDoc(size: [number, number] = [595.28, 841.89]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold };
}

function watermark(c: Ctx, w: number, h: number, label: string) {
  c.page.drawText(safe(label), { x: 60, y: h / 2 - 80, size: 36, font: c.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: { type: 'degrees' as never, angle: 35 } as never });
}

/** DANFE retrato (NF-e modelo 55) */
export async function danfePdf(inv: Invoice & { items: InvoiceItem[] }, company: Company, customer?: { street?: string | null; number?: string | null; district?: string | null; city?: string | null; uf?: string | null; zip?: string | null; ie?: string | null; phone?: string | null } | null) {
  if (inv.model === 'NFCE') return danfcePdf(inv, company);
  if (inv.model === 'NFSE') return nfsePdf(inv, company);
  const { doc, page, font, bold } = await newDoc();
  const c = { page, font, bold };
  const W = 595.28, M = 20;
  let y = 800;
  // Canhoto
  box(c, M, y, 450, 22, 'Recebemos de ' + company.name + ' os produtos constantes da nota fiscal indicada ao lado', '');
  box(c, M + 450, y, W - 2 * M - 450, 22, 'NF-e', `Nº ${inv.number}  Série ${inv.series}`, 8, true);
  y -= 30;
  // Cabeçalho
  box(c, M, y - 80, 230, 90);
  text(c, company.tradeName || company.name, M + 6, y - 5, 11, true);
  text(c, company.name, M + 6, y - 18, 7);
  text(c, `${company.street || ''}, ${company.number || ''} - ${company.district || ''}`, M + 6, y - 30, 7);
  text(c, `${company.city || ''}/${company.uf} - CEP ${fmtCep(company.zip)}`, M + 6, y - 40, 7);
  text(c, `Fone: ${company.phone || ''}`, M + 6, y - 50, 7);
  box(c, M + 230, y - 80, 100, 90);
  text(c, 'DANFE', M + 258, y - 8, 12, true);
  text(c, 'Documento Auxiliar da', M + 238, y - 20, 6);
  text(c, 'Nota Fiscal Eletrônica', M + 238, y - 28, 6);
  text(c, `${inv.direction === 'ENTRADA' ? '0' : '1'} - ${inv.direction === 'ENTRADA' ? 'Entrada' : 'Saída'}`, M + 240, y - 42, 8, true);
  text(c, `Nº ${String(inv.number).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}`, M + 240, y - 56, 8, true);
  text(c, `Série ${inv.series}  Folha 1/1`, M + 240, y - 68, 7);
  box(c, M + 330, y - 80, W - 2 * M - 330, 90);
  if (inv.accessKey) {
    const img = await barcode(doc, 'code128', inv.accessKey, { height: 9 });
    if (img) page.drawImage(img, { x: M + 336, y: y - 30, width: W - 2 * M - 342, height: 32 });
    text(c, 'CHAVE DE ACESSO', M + 336, y - 40, 5.5);
    text(c, formatAccessKey(inv.accessKey), M + 336, y - 50, 7.2, true);
    text(c, 'Consulta de autenticidade no portal nacional da NF-e', M + 336, y - 62, 6);
    text(c, 'www.nfe.fazenda.gov.br/portal (ambiente simulado)', M + 336, y - 70, 6);
  }
  y -= 102;
  box(c, M, y, 330, 20, 'Natureza da operação', inv.natureName);
  box(c, M + 330, y, W - 2 * M - 330, 20, 'Protocolo de autorização de uso', inv.protocol ? `${inv.protocol} - ${fmtDateTime(inv.authorizedAt)}` : 'NÃO AUTORIZADA');
  y -= 20;
  box(c, M, y, 185, 20, 'Inscrição estadual', company.ie);
  box(c, M + 185, y, 185, 20, 'Insc. municipal', company.im);
  box(c, M + 370, y, W - 2 * M - 370, 20, 'CNPJ', fmtDoc(company.cnpj));
  y -= 30;
  text(c, 'DESTINATÁRIO / REMETENTE', M, y + 4, 7, true);
  y -= 18;
  box(c, M, y, 330, 20, 'Nome / Razão social', inv.customerName);
  box(c, M + 330, y, 130, 20, 'CNPJ / CPF', fmtDoc(inv.customerDoc));
  box(c, M + 460, y, W - 2 * M - 460, 20, 'Data de emissão', fmtDate(inv.issueDate));
  y -= 20;
  box(c, M, y, 260, 20, 'Endereço', `${customer?.street || ''}, ${customer?.number || ''}`);
  box(c, M + 260, y, 130, 20, 'Bairro', customer?.district);
  box(c, M + 390, y, 70, 20, 'CEP', fmtCep(customer?.zip));
  box(c, M + 460, y, W - 2 * M - 460, 20, 'Data saída', fmtDate(inv.issueDate));
  y -= 20;
  box(c, M, y, 220, 20, 'Município', customer?.city);
  box(c, M + 220, y, 40, 20, 'UF', inv.customerUf);
  box(c, M + 260, y, 130, 20, 'Fone', customer?.phone);
  box(c, M + 390, y, W - 2 * M - 390, 20, 'Inscrição estadual', customer?.ie);
  y -= 30;
  text(c, 'CÁLCULO DO IMPOSTO', M, y + 4, 7, true);
  y -= 18;
  const tw = (W - 2 * M) / 7;
  [['Base de cálc. ICMS', inv.icmsBase], ['Valor do ICMS', inv.icmsValue], ['Valor do IPI', inv.ipiValue], ['Valor PIS', inv.pisValue], ['Valor COFINS', inv.cofinsValue], ['Valor total produtos', inv.productsTotal], ['Valor total da nota', inv.total]].forEach(([l, v], i) =>
    box(c, M + i * tw, y, tw, 20, String(l), num(Number(v), 2), 8, i === 6),
  );
  y -= 20;
  [['Valor do frete', inv.freight], ['Valor do seguro', 0], ['Desconto', inv.discount], ['Outras despesas', 0], ['Tributos aprox.', inv.approxTaxes], ['', ''], ['', '']].forEach(([l, v], i) => box(c, M + i * tw, y, tw, 20, String(l), v === '' ? '' : num(Number(v), 2)));
  y -= 30;
  text(c, 'DADOS DOS PRODUTOS / SERVIÇOS', M, y + 4, 7, true);
  y -= 16;
  const cols = [
    ['Código', 55], ['Descrição', 165], ['NCM', 45], ['CST', 25], ['CFOP', 30], ['UN', 22], ['Qtd', 35], ['V. unit', 45], ['V. total', 45], ['BC ICMS', 40], ['V. ICMS', 35], ['V. IPI', 30], ['% ICMS', 33],
  ] as const;
  let x = M;
  cols.forEach(([l, w]) => {
    box(c, x, y, w, 14, undefined);
    text(c, l, x + 2, y + 4, 6, true);
    x += w;
  });
  for (const it of inv.items) {
    y -= 13;
    if (y < 90) break;
    x = M;
    const vals = [it.code, it.description, it.ncm, it.cst, it.cfop, it.unit, num(it.quantity, 3), num(it.unitPrice, 2), num(it.total, 2), num(it.icmsBase, 2), num(it.icmsValue, 2), num(it.ipiValue, 2), num(it.icmsRate, 2)];
    cols.forEach(([, w], i) => {
      page.drawText(fit(font, String(vals[i] ?? ''), 6.5, w - 3), { x: x + 2, y: y + 4, size: 6.5, font });
      x += w;
    });
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.2, color: rgb(0.7, 0.7, 0.7) });
  }
  // Dados adicionais
  box(c, M, 30, W - 2 * M, 55, 'Dados adicionais / Informações complementares');
  const info = safe(inv.additionalInfo || '');
  for (let i = 0; i < 4; i++) text(c, info.slice(i * 140, (i + 1) * 140), M + 4, 68 - i * 9, 6.5);
  if (inv.status === 'CANCELADA') watermark(c, W, 841, 'NF-e CANCELADA');
  else watermark(c, W, 841, 'SEM VALOR FISCAL - SIMULAÇÃO');
  return doc.save();
}

/** DANFE NFC-e (bobina 80mm) com QR Code */
export async function danfcePdf(inv: Invoice & { items: InvoiceItem[] }, company: Company) {
  const h = 420 + inv.items.length * 22;
  const { doc, page, font, bold } = await newDoc([226, h]);
  const c = { page, font, bold };
  let y = h - 20;
  const center = (s: string, size = 7, b = false) => {
    const t = safe(s);
    const w = (b ? bold : font).widthOfTextAtSize(t, size);
    text(c, t, (226 - w) / 2, y, size, b);
    y -= size + 3;
  };
  center(company.tradeName || company.name, 9, true);
  center(`CNPJ ${fmtDoc(company.cnpj)}  IE ${company.ie || ''}`);
  center(`${company.street || ''}, ${company.number || ''} - ${company.city || ''}/${company.uf}`);
  y -= 4;
  center('DANFE NFC-e - Documento Auxiliar da Nota Fiscal', 6.5, true);
  center('de Consumidor Eletrônica', 6.5, true);
  y -= 4;
  text(c, 'Código   Descrição          Qtd  UN  Vl Unit   Vl Total', 8, y, 6, true);
  y -= 10;
  for (const it of inv.items) {
    text(c, fit(font, `${it.code} ${it.description}`, 6.5, 210), 8, y, 6.5);
    y -= 9;
    text(c, `${num(it.quantity, 3)} ${it.unit} x ${num(it.unitPrice, 2)}`, 60, y, 6.5);
    text(c, num(it.total, 2), 180, y, 6.5);
    y -= 12;
  }
  y -= 4;
  text(c, `Qtd. total de itens: ${inv.items.length}`, 8, y, 7); y -= 10;
  if (inv.discount) { text(c, `Desconto: R$ ${num(inv.discount, 2)}`, 8, y, 7); y -= 10; }
  text(c, `VALOR A PAGAR R$ ${num(inv.total, 2)}`, 8, y, 9, true); y -= 14;
  text(c, `Tributos totais incidentes (Lei 12.741/2012): R$ ${num(inv.approxTaxes, 2)}`, 8, y, 6); y -= 14;
  center(`NFC-e nº ${inv.number}  Série ${inv.series}  ${fmtDateTime(inv.authorizedAt || inv.issueDate)}`, 6.5, true);
  center('Consulte pela Chave de Acesso em www.nfce.fazenda.sp.gov.br', 6);
  if (inv.accessKey) center(formatAccessKey(inv.accessKey), 6);
  center(inv.customerDoc ? `CONSUMIDOR CPF/CNPJ: ${fmtDoc(inv.customerDoc)}` : 'CONSUMIDOR NÃO IDENTIFICADO', 6.5);
  center(`Protocolo de autorização: ${inv.protocol || '-'}`, 6);
  const qrUrl = `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${inv.accessKey}|2|2|${company.cscId || '1'}|SIMULADO`;
  const qr = await barcode(doc, 'qrcode', qrUrl, { scale: 3, height: undefined });
  if (qr) page.drawImage(qr, { x: 63, y: y - 105, width: 100, height: 100 });
  y -= 115;
  center('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL', 6, true);
  if (inv.status === 'CANCELADA') watermark(c, 226, h, 'CANCELADA');
  return doc.save();
}

export async function nfsePdf(inv: Invoice & { items: InvoiceItem[] }, company: Company) {
  const { doc, page, font, bold } = await newDoc();
  const c = { page, font, bold };
  const M = 30, W = 595.28;
  let y = 800;
  text(c, `PREFEITURA MUNICIPAL DE ${(company.city || 'SÃO PAULO').toUpperCase()}`, M, y, 11, true); y -= 14;
  text(c, 'NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e (SIMULADA)', M, y, 10, true); y -= 20;
  box(c, M, y - 20, 170, 28, 'Número da nota', inv.number, 10, true);
  box(c, M + 170, y - 20, 170, 28, 'Data e hora de emissão', fmtDateTime(inv.authorizedAt || inv.issueDate));
  box(c, M + 340, y - 20, W - 2 * M - 340, 28, 'Código de verificação', inv.verificationCode, 10, true);
  y -= 40;
  text(c, 'PRESTADOR DE SERVIÇOS', M, y, 8, true); y -= 12;
  text(c, `${company.name}  -  CNPJ ${fmtDoc(company.cnpj)}  -  IM ${company.im || ''}`, M, y, 8); y -= 10;
  text(c, `${company.street || ''}, ${company.number || ''} - ${company.district || ''} - ${company.city || ''}/${company.uf}`, M, y, 8); y -= 20;
  text(c, 'TOMADOR DE SERVIÇOS', M, y, 8, true); y -= 12;
  text(c, `${inv.customerName}  -  CPF/CNPJ ${fmtDoc(inv.customerDoc)}`, M, y, 8); y -= 20;
  text(c, 'DISCRIMINAÇÃO DOS SERVIÇOS', M, y, 8, true); y -= 14;
  for (const it of inv.items) {
    text(c, `${it.code} - ${it.description}`, M, y, 8);
    text(c, `${num(it.quantity)} x ${money(it.unitPrice)} = ${money(it.total)}`, 400, y, 8);
    y -= 12;
  }
  y -= 10;
  box(c, M, y - 20, 130, 26, 'Valor total do serviço', money(inv.servicesTotal), 9, true);
  box(c, M + 130, y - 20, 100, 26, 'Deduções', money(inv.discount));
  box(c, M + 230, y - 20, 100, 26, 'Base de cálculo', money(inv.servicesTotal - inv.discount));
  box(c, M + 330, y - 20, 80, 26, 'Alíquota ISS', `${num(inv.items[0]?.issRate || 0)}%`);
  box(c, M + 410, y - 20, W - 2 * M - 410, 26, 'Valor do ISS', money(inv.issValue), 9, true);
  y -= 40;
  text(c, safe(inv.additionalInfo || '').slice(0, 150), M, y, 7);
  watermark(c, W, 841, inv.status === 'CANCELADA' ? 'NFS-e CANCELADA' : 'SEM VALOR FISCAL - SIMULAÇÃO');
  return doc.save();
}

/** Boleto bancário (ficha de compensação) */
export async function boletoPdf(entry: FinancialEntry, company: Company, bank: BankAccount | null, payer: { name: string; document?: string | null; street?: string | null; city?: string | null; uf?: string | null; zip?: string | null } | null) {
  const { doc, page, font, bold } = await newDoc();
  const c = { page, font, bold };
  const M = 30, W = 595.28 - 60;
  let y = 790;
  text(c, 'RECIBO DO PAGADOR', M, y + 6, 9, true);
  y -= 24;
  box(c, M, y, W * 0.5, 22, 'Beneficiário', `${company.name} - CNPJ ${fmtDoc(company.cnpj)}`);
  box(c, M + W * 0.5, y, W * 0.25, 22, 'Vencimento', fmtDate(entry.dueDate), 9, true);
  box(c, M + W * 0.75, y, W * 0.25, 22, 'Valor do documento', money(entry.amount - entry.paidAmount), 9, true);
  y -= 22;
  box(c, M, y, W * 0.5, 22, 'Pagador', payer?.name);
  box(c, M + W * 0.5, y, W * 0.25, 22, 'Nosso número', entry.boletoNumber);
  box(c, M + W * 0.75, y, W * 0.25, 22, 'Nº documento', entry.documentNumber);
  y -= 50;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, dashArray: [3, 3] });
  y -= 30;
  text(c, `${(bank?.bankName || 'GestãoPro Bank').replace(' (simulado)', '')} | ${bank?.bankCode || '999'}-9`, M, y, 11, true);
  text(c, entry.boletoLine || '', M + W - bold.widthOfTextAtSize(safe(entry.boletoLine || ''), 10.5), y, 10.5, true);
  y -= 10;
  const rows: [string, string, number][][] = [
    [['Local de pagamento', 'Pagável em qualquer banco ou via Pix até o vencimento (SIMULADO)', 0.75], ['Vencimento', fmtDate(entry.dueDate), 0.25]],
    [['Beneficiário', `${company.name} - ${fmtDoc(company.cnpj)}`, 0.75], ['Agência/Código beneficiário', `${bank?.agency || '0001'} / ${bank?.accountNumber || '123456-7'}`, 0.25]],
    [['Data do documento', fmtDate(entry.issueDate), 0.18], ['Nº do documento', entry.documentNumber || '', 0.2], ['Espécie doc.', 'DM', 0.12], ['Aceite', 'N', 0.1], ['Data processamento', fmtDate(new Date()), 0.15], ['Nosso número', entry.boletoNumber || '', 0.25]],
    [['Uso do banco', '', 0.18], ['Carteira', '109', 0.12], ['Espécie', 'R$', 0.1], ['Quantidade', '', 0.18], ['Valor', '', 0.17], ['(=) Valor do documento', money(entry.amount - entry.paidAmount), 0.25]],
  ];
  for (const r of rows) {
    y -= 22;
    let x = M;
    for (const [l, v, w] of r) {
      box(c, x, y, W * w, 22, l, v, 8, l.includes('Valor do documento') || l === 'Vencimento');
      x += W * w;
    }
  }
  y -= 60;
  box(c, M, y, W * 0.75, 60, 'Instruções (texto de responsabilidade do beneficiário)');
  text(c, 'Após o vencimento cobrar multa de 2% e juros de 1% ao mês.', M + 4, y + 38, 8);
  text(c, entry.description, M + 4, y + 26, 8);
  text(c, 'BOLETO SIMULADO - NÃO PAGUE. Ambiente de demonstração GestãoPro.', M + 4, y + 10, 8, true, rgb(0.8, 0.1, 0.1));
  box(c, M + W * 0.75, y, W * 0.25, 60, '(-) Desconto / (+) Juros / (=) Valor cobrado');
  y -= 40;
  box(c, M, y, W, 40, 'Pagador', `${payer?.name || ''} - ${fmtDoc(payer?.document)} - ${payer?.street || ''} ${payer?.city || ''}/${payer?.uf || ''} CEP ${fmtCep(payer?.zip)}`);
  y -= 60;
  if (entry.boletoBarcode) {
    const img = await barcode(doc, 'interleaved2of5', entry.boletoBarcode, { height: 13, scale: 2 });
    if (img) page.drawImage(img, { x: M, y, width: 103 * 3.6, height: 50 });
  }
  if (entry.pixPayload) {
    const qr = await barcode(doc, 'qrcode', entry.pixPayload, { scale: 3, height: undefined });
    if (qr) page.drawImage(qr, { x: M + W - 95, y: y - 30, width: 90, height: 90 });
    text(c, 'Pague com Pix', M + W - 88, y - 40, 8, true);
  }
  return doc.save();
}

export type LabelProduct = { sku: string; name: string; price: number; gtin?: string | null; copies: number; extra?: string };

/** Etiquetas de produto em folha A4 (3 colunas x 10 linhas — padrão Pimaco 6180) */
export async function productLabelsPdf(items: LabelProduct[], opts: { showPrice?: boolean; title?: string } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cols = 3, rows = 10, lw = 189, lh = 72, mx = 14, my = 36;
  const flat = items.flatMap((i) => Array.from({ length: Math.max(1, i.copies) }, () => i));
  let page: PDFPage | null = null;
  for (let i = 0; i < flat.length; i++) {
    if (i % (cols * rows) === 0) page = doc.addPage([595.28, 841.89]);
    const it = flat[i];
    const idx = i % (cols * rows);
    const x = mx + (idx % cols) * (lw + 4);
    const y = 841.89 - my - (Math.floor(idx / cols) + 1) * lh;
    page!.drawRectangle({ x, y, width: lw, height: lh - 4, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.4 });
    page!.drawText(fit(bold, it.name, 7.5, lw - 8), { x: x + 4, y: y + lh - 15, size: 7.5, font: bold });
    page!.drawText(safe(`SKU ${it.sku}${it.extra ? ' | ' + it.extra : ''}`), { x: x + 4, y: y + lh - 24, size: 6, font });
    const code = it.gtin && /^\d{13}$/.test(it.gtin) ? it.gtin : it.sku;
    const img = await barcode(doc, /^\d{13}$/.test(code) ? 'ean13' : 'code128', code, { height: 8, includetext: true, textsize: 8 });
    if (img) page!.drawImage(img, { x: x + 4, y: y + 4, width: opts.showPrice === false ? lw - 8 : 110, height: 36 });
    if (opts.showPrice !== false) page!.drawText(safe(money(it.price)), { x: x + 120, y: y + 18, size: 11, font: bold });
  }
  if (!flat.length) doc.addPage();
  return doc.save();
}

/** Etiquetas de estoque/endereçamento com QR Code (produto, lote, localização, saldo) */
export async function stockLabelsPdf(items: { sku: string; name: string; location?: string | null; lot?: string | null; expiresAt?: Date | null; quantity: number; warehouse: string }[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lw = 280, lh = 130;
  let page: PDFPage | null = null;
  for (let i = 0; i < items.length; i++) {
    if (i % 12 === 0) page = doc.addPage([595.28, 841.89]);
    const idx = i % 12;
    const x = 15 + (idx % 2) * (lw + 5);
    const y = 841.89 - 20 - (Math.floor(idx / 2) + 1) * (lh + 4);
    const it = items[i];
    page!.drawRectangle({ x, y, width: lw, height: lh, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    page!.drawText(fit(bold, it.name, 10, lw - 110), { x: x + 8, y: y + lh - 20, size: 10, font: bold });
    const lines = [`SKU: ${it.sku}`, `Depósito: ${it.warehouse}`, `Localização: ${it.location || '-'}`, `Lote: ${it.lot || '-'}  Val.: ${it.expiresAt ? fmtDate(it.expiresAt) : '-'}`, `Saldo: ${num(it.quantity, 3)}`];
    lines.forEach((l, j) => page!.drawText(safe(l), { x: x + 8, y: y + lh - 38 - j * 14, size: 8.5, font }));
    const qr = await barcode(doc, 'qrcode', JSON.stringify({ sku: it.sku, lot: it.lot, loc: it.location }), { scale: 3, height: undefined });
    if (qr) page!.drawImage(qr, { x: x + lw - 100, y: y + 15, width: 90, height: 90 });
  }
  if (!items.length) doc.addPage();
  return doc.save();
}

/** Etiqueta de envio 10x15 cm */
export async function shippingLabelPdf(list: { shipment: Shipment; order: SalesOrder & { customer: { name: string } }; company: Company }[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const { shipment, order, company } of list) {
    const page = doc.addPage([283.46, 425.2]);
    const c = { page, font, bold };
    const to = (order.shipTo || {}) as Record<string, string>;
    page.drawRectangle({ x: 6, y: 6, width: 271, height: 413, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    text(c, shipment.carrier.toUpperCase(), 14, 398, 14, true);
    text(c, shipment.service, 14, 384, 9);
    text(c, `Pedido ${order.number}${order.externalId ? ' / ' + order.externalId : ''}`, 150, 398, 7);
    text(c, `Peso: ${num(shipment.weight, 3)} kg`, 150, 388, 7);
    text(c, `Volume 1/1`, 150, 378, 7);
    if (shipment.trackingCode) {
      const img = await barcode(doc, 'code128', shipment.trackingCode, { height: 14 });
      if (img) page.drawImage(img, { x: 20, y: 300, width: 243, height: 62 });
      text(c, shipment.trackingCode, 85, 288, 11, true);
    }
    page.drawLine({ start: { x: 6, y: 280 }, end: { x: 277, y: 280 }, thickness: 1 });
    text(c, 'DESTINATÁRIO', 14, 266, 8, true);
    text(c, to.name || order.customer.name, 14, 252, 10, true);
    text(c, `${to.street || ''}, ${to.number || ''} ${to.complement || ''}`, 14, 238, 9);
    text(c, `${to.district || ''}`, 14, 226, 9);
    text(c, `${fmtCep(to.zip)}  ${to.city || ''}/${to.uf || ''}`, 14, 212, 11, true);
    const cep = await barcode(doc, 'code128', (to.zip || '00000000').replace(/\D/g, '') || '00000000', { height: 10 });
    if (cep) page.drawImage(cep, { x: 14, y: 160, width: 140, height: 40 });
    const dm = await barcode(doc, 'datamatrix', `${to.zip}|${shipment.trackingCode}|${order.number}`, { scale: 3, height: undefined });
    if (dm) page.drawImage(dm, { x: 190, y: 150, width: 70, height: 70 });
    page.drawLine({ start: { x: 6, y: 140 }, end: { x: 277, y: 140 }, thickness: 1 });
    text(c, 'REMETENTE', 14, 126, 8, true);
    text(c, company.tradeName || company.name, 14, 112, 9, true);
    text(c, `${company.street || ''}, ${company.number || ''} - ${company.district || ''}`, 14, 100, 8);
    text(c, `${fmtCep(company.zip)}  ${company.city || ''}/${company.uf}`, 14, 88, 8);
    text(c, 'ETIQUETA SIMULADA - NÃO VÁLIDA PARA POSTAGEM', 30, 20, 8, true, rgb(0.8, 0.1, 0.1));
  }
  if (!list.length) doc.addPage();
  return doc.save();
}

/** Relatório tabular genérico (paisagem quando muitas colunas) */
export async function tablePdf(title: string, columns: { key: string; label: string; align?: 'right' }[], rows: Record<string, unknown>[], subtitle?: string, totals?: Record<string, unknown>) {
  const landscape = columns.length > 6;
  const size: [number, number] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 28;
  const usable = size[0] - 2 * M;
  const colW = usable / columns.length;
  let page = doc.addPage(size);
  let y = size[1] - M;
  const header = () => {
    page.drawText(safe(title), { x: M, y, size: 13, font: bold });
    y -= 14;
    page.drawText(safe(`${subtitle || ''}  Gerado em ${fmtDateTime(new Date())} - GestãoPro`), { x: M, y, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 18;
    page.drawRectangle({ x: M, y: y - 3, width: usable, height: 14, color: rgb(0.09, 0.64, 0.29) });
    columns.forEach((c, i) => page.drawText(fit(bold, c.label, 7, colW - 4), { x: M + i * colW + 2, y: y + 1, size: 7, font: bold, color: rgb(1, 1, 1) }));
    y -= 14;
  };
  header();
  const cell = (v: unknown) => (typeof v === 'number' ? num(v, 2) : v instanceof Date ? fmtDate(v) : String(v ?? ''));
  rows.forEach((r, ri) => {
    if (y < M + 20) {
      page = doc.addPage(size);
      y = size[1] - M;
      header();
    }
    if (ri % 2) page.drawRectangle({ x: M, y: y - 3, width: usable, height: 12, color: rgb(0.96, 0.97, 0.96) });
    columns.forEach((c, i) => {
      const t = fit(font, cell(r[c.key]), 7, colW - 4);
      const w = font.widthOfTextAtSize(t, 7);
      page.drawText(t, { x: c.align === 'right' ? M + (i + 1) * colW - w - 2 : M + i * colW + 2, y, size: 7, font });
    });
    y -= 12;
  });
  if (totals) {
    y -= 4;
    columns.forEach((c, i) => {
      if (totals[c.key] == null) return;
      const t = fit(bold, cell(totals[c.key]), 7.5, colW - 4);
      const w = bold.widthOfTextAtSize(t, 7.5);
      page.drawText(t, { x: c.align === 'right' ? M + (i + 1) * colW - w - 2 : M + i * colW + 2, y, size: 7.5, font: bold });
    });
  }
  return doc.save();
}
