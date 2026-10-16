/**
 * Utilitários de XML dos documentos fiscais eletrônicos (NF-e, NFC-e, MDF-e,
 * NFS-e Nacional, GNRE): escape compatível com C14N, data/hora com fuso da UF,
 * leitura de tags dos retornos, compactação (docZip / GZip+Base64), dígito da
 * chave de acesso e assinatura de um elemento identificado (Id).
 */
import zlib from 'zlib';
import { onlyDigits } from '@/lib/utils';
import { signElement } from '../cert';

/** Escape de texto — o mesmo da forma canônica C14N (aspas não são escapadas em texto) */
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');

/** Texto de campo: sem espaços nas pontas/duplicados e sem caracteres de controle (exigência dos schemas) */
export const txt = (s: unknown, max = 0) => {
  let v = String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && v.length > max) v = v.slice(0, max).trim();
  return esc(v);
};

export const dec = (n: unknown, d = 2) => (Number(n) || 0).toFixed(d);

/** Elemento simples (omitido quando o valor é vazio e `optional`) */
export const el = (name: string, value: unknown, optional = false) => {
  const v = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (optional && v === '') return '';
  return `<${name}>${v}</${name}>`;
};

/** Fuso horário por UF (sem horário de verão desde 2019) */
const UTC_OFFSET: Record<string, number> = { AC: -5, AM: -4, RR: -4, RO: -4, MT: -4, MS: -4 };

/** Data/hora no formato AAAA-MM-DDThh:mm:ss-03:00 (TDateTimeUTC) */
export function dhUF(d: Date, uf = 'SP') {
  const off = UTC_OFFSET[uf] ?? -3;
  const local = new Date(d.getTime() + off * 3600000);
  const sign = off < 0 ? '-' : '+';
  return `${local.toISOString().slice(0, 19)}${sign}${String(Math.abs(off)).padStart(2, '0')}:00`;
}
/** Data AAAA-MM-DD no fuso da UF */
export const dUF = (d: Date, uf = 'SP') => dhUF(d, uf).slice(0, 10);

/** Conteúdo do primeiro elemento `name` (ignora prefixo de namespace) */
export function tag(xml: string | null | undefined, name: string): string | null {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? m[1] : null;
}
/** Todos os conteúdos de `name` */
export function tags(xml: string | null | undefined, name: string): string[] {
  if (!xml) return [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}
/** Elemento completo (com a tag de abertura e fechamento) */
export function block(xml: string | null | undefined, name: string): string | null {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w-]+:)?${name}>`));
  return m ? m[0] : null;
}
export function blocks(xml: string | null | undefined, name: string): string[] {
  if (!xml) return [];
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w-]+:)?${name}>`, 'g'))].map((m) => m[0]);
}
export const attr = (xml: string | null | undefined, name: string) => xml?.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

export const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#xD;/gi, '\r').replace(/&amp;/g, '&');

export const stripDecl = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

/** docZip da Distribuição DF-e: Base64 de GZip */
export const unzipB64 = (b64: string) => zlib.gunzipSync(Buffer.from(b64.trim(), 'base64')).toString('utf8');
export const gzipB64 = (s: string) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');

/** Módulo 11 (pesos 2..9) — DV das chaves de NF-e, NFC-e, MDF-e e CT-e */
export function mod11Dv(s: string) {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Chave de 44 dígitos genérica: cUF AAMM CNPJ mod série número tpEmis código DV */
export function dfeKey(p: { cUF: string; date: Date; cnpj: string; mod: number; series: number; number: number; tpEmis: number; code: string }) {
  const aamm = `${String(p.date.getFullYear()).slice(2)}${String(p.date.getMonth() + 1).padStart(2, '0')}`;
  const base = `${p.cUF}${aamm}${onlyDigits(p.cnpj).padStart(14, '0')}${String(p.mod).padStart(2, '0')}${String(p.series).padStart(3, '0')}${String(p.number).padStart(9, '0')}${p.tpEmis}${p.code.padStart(8, '0')}`;
  return base + mod11Dv(base);
}

/**
 * Assina o elemento `tagName` de `xml` (gerado SEM namespace próprio e sem
 * elementos vazios autofechados) com o namespace herdado `ns`. A forma
 * canônica (C14N) declara o namespace no próprio elemento; atributos em ordem
 * (Id antes de versao). Retorna o bloco <Signature>.
 */
export function signInf(element: string, tagName: string, ns: string, pfx: Buffer, password: string) {
  const id = attr(element.slice(0, element.indexOf('>') + 1), 'Id');
  if (!id) throw new Error(`Elemento ${tagName} sem atributo Id`);
  return signElement(canonicalOf(element, tagName, ns), id, pfx, password);
}
export const canonicalOf = (element: string, tagName: string, ns: string) => element.replace(`<${tagName} `, `<${tagName} xmlns="${ns}" `);

export const NS = {
  NFE: 'http://www.portalfiscal.inf.br/nfe',
  MDFE: 'http://www.portalfiscal.inf.br/mdfe',
  NFSE: 'http://www.sped.fazenda.gov.br/nfse',
  GNRE: 'http://www.gnre.pe.gov.br',
};
