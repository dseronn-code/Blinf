/**
 * Utilitários brasileiros: validação de CPF/CNPJ, chave de acesso NF-e,
 * BR Code Pix (EMV), linha digitável de boleto (FEBRABAN) e código de
 * rastreio dos Correios. Algoritmos reais; dados emitidos são simulados.
 */
import { onlyDigits, randomDigits } from './utils';

export function isValidCPF(cpf: string) {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function isValidCNPJ(cnpj: string) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Gera CPF válido (para dados de demonstração) */
export function generateCPF() {
  const n = randomDigits(9);
  const calc = (s: string) => {
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(n);
  const d2 = calc(n + d1);
  return `${n}${d1}${d2}`;
}

export function generateCNPJ() {
  const n = randomDigits(8) + '0001';
  const calc = (s: string) => {
    const w = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(s[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(n);
  const d2 = calc(n + d1);
  return `${n}${d1}${d2}`;
}

export const UF_CODES: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24',
  PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42',
  RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};
export const UFS = Object.keys(UF_CODES);

/** Alíquota interna padrão de ICMS por UF (aproximação 2025/2026) */
export const ICMS_INTERNAL: Record<string, number> = {
  AC: 19, AL: 19, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17, MT: 17, PA: 19,
  PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 22, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 20, SP: 18, TO: 20,
};

/** Alíquota interestadual: 7% de S/SE (exceto ES) para N/NE/CO/ES; 12% nos demais casos; 4% importados */
export function interstateIcmsRate(fromUf: string, toUf: string, origin = 0) {
  if ([1, 2, 3, 8].includes(origin)) return 4;
  const southSoutheast = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'];
  if (southSoutheast.includes(fromUf) && !southSoutheast.includes(toUf)) return 7;
  return 12;
}

/** Módulo 11 para dígito da chave de acesso (pesos 2..9) */
function mod11Key(s: string) {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * Chave de acesso NF-e/NFC-e (44 dígitos):
 * cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) DV(1)
 */
export function buildAccessKey(p: { uf: string; date: Date; cnpj: string; model: 55 | 65; series: number; number: number; code?: string; tpEmis?: number }) {
  const cuf = UF_CODES[p.uf] || '35';
  const aamm = `${String(p.date.getFullYear()).slice(2)}${String(p.date.getMonth() + 1).padStart(2, '0')}`;
  const cnpj = onlyDigits(p.cnpj).padStart(14, '0');
  const base = `${cuf}${aamm}${cnpj}${p.model}${String(p.series).padStart(3, '0')}${String(p.number).padStart(9, '0')}${p.tpEmis || 1}${(p.code || randomDigits(8)).padStart(8, '0')}`;
  return base + mod11Key(base);
}

export function isValidAccessKey(key: string) {
  const d = onlyDigits(key);
  return d.length === 44 && mod11Key(d.slice(0, 43)) === Number(d[43]);
}

export function formatAccessKey(key: string) {
  return onlyDigits(key).replace(/(\d{4})/g, '$1 ').trim();
}

// ---------------------------------------------------------------------------
// Pix — BR Code (padrão EMV QRCPS-MPM) com CRC16-CCITT
// ---------------------------------------------------------------------------
function emv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}
function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function asciiOnly(s: string, max: number) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, max);
}
export function buildPixPayload(p: { key: string; name: string; city: string; amount?: number; txid?: string; description?: string }) {
  const gui = emv('00', 'br.gov.bcb.pix') + emv('01', p.key) + (p.description ? emv('02', p.description.slice(0, 40)) : '');
  let payload =
    emv('00', '01') +
    emv('26', gui) +
    emv('52', '0000') +
    emv('53', '986') +
    (p.amount ? emv('54', p.amount.toFixed(2)) : '') +
    emv('58', 'BR') +
    emv('59', asciiOnly(p.name, 25) || 'EMPRESA') +
    emv('60', asciiOnly(p.city, 15) || 'SAO PAULO') +
    emv('62', emv('05', (p.txid || '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25)));
  payload += '6304';
  return payload + crc16(payload);
}

// ---------------------------------------------------------------------------
// Boleto bancário — código de barras (44) e linha digitável (47) FEBRABAN
// ---------------------------------------------------------------------------
function mod10(s: string) {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    let p = Number(s[i]) * w;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    w = w === 2 ? 1 : 2;
  }
  const r = (10 - (sum % 10)) % 10;
  return r;
}
function mod11Barcode(s: string) {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = 11 - (sum % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}
/** Fator de vencimento (base 07/10/1997, reiniciado em 22/02/2025 para 1000) */
function dueFactor(due: Date) {
  const base = Date.UTC(1997, 9, 7);
  const d = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  let f = Math.round((d - base) / 86400000);
  while (f > 9999) f -= 9000;
  return String(f).padStart(4, '0');
}
export function buildBoleto(p: { bankCode: string; amount: number; dueDate: Date; ourNumber: string; agency?: string; account?: string }) {
  const bank = p.bankCode.padStart(3, '0').slice(0, 3);
  const free = (`${(p.agency || '0001').padStart(4, '0')}${p.ourNumber.padStart(11, '0')}${(p.account || '1234567').padStart(7, '0')}`)
    .replace(/\D/g, '0')
    .slice(0, 25)
    .padEnd(25, '0');
  const value = String(Math.round(p.amount * 100)).padStart(10, '0');
  const factor = dueFactor(p.dueDate);
  const noDv = `${bank}9${factor}${value}${free}`;
  const dv = mod11Barcode(noDv);
  const barcode = `${bank}9${dv}${factor}${value}${free}`;
  const f1 = `${bank}9${free.slice(0, 5)}`;
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);
  const line = `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${dv}${factor}${value}`;
  const formatted = `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line.slice(32, 33)} ${line.slice(33)}`;
  return { barcode, line, formatted };
}

// ---------------------------------------------------------------------------
// Código de rastreio padrão UPU/Correios: AA 8 dígitos + DV + BR
// ---------------------------------------------------------------------------
export function buildTrackingCode(prefix = 'QB') {
  const n = randomDigits(8);
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = n.split('').reduce((a, c, i) => a + Number(c) * w[i], 0);
  let dv = 11 - (sum % 11);
  if (dv === 10) dv = 0;
  if (dv === 11) dv = 5;
  return `${prefix}${n}${dv}BR`;
}

/** EAN-13 válido a partir de 12 dígitos */
export function buildEan13(base12: string) {
  const d = onlyDigits(base12).padStart(12, '0').slice(0, 12);
  const sum = d.split('').reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return d + ((10 - (sum % 10)) % 10);
}

/** Fundo de Combate à Pobreza (FCP) — percentual adicional por UF de destino (aproximação) */
export const FCP_RATE: Record<string, number> = { AL: 1, BA: 2, CE: 2, GO: 2, MA: 2, MG: 2, MS: 2, MT: 2, PB: 2, PE: 2, PI: 1, RJ: 2, RN: 2, SE: 1, TO: 2 };

/** Reforma tributária (LC 214/2025) — alíquotas de teste de 2026 (informativas no documento) */
export const CBS_RATE = Number(process.env.CBS_RATE ?? 0.9);
export const IBS_RATE = Number(process.env.IBS_RATE ?? 0.1);

/** Região aproximada pelo 1º dígito do CEP (para simulação de frete) */
export function cepRegion(cep: string) {
  const d = Number(onlyDigits(cep)[0] ?? 0);
  return d;
}
