import { describe, it, expect } from 'vitest';
import { isValidCPF, isValidCNPJ, generateCPF, generateCNPJ, buildAccessKey, isValidAccessKey, buildPixPayload, buildBoleto, buildEan13, interstateIcmsRate } from '@/lib/br';

describe('documentos', () => {
  it('valida CPF e CNPJ (dígitos verificadores)', () => {
    expect(isValidCPF('52998224725')).toBe(true);
    expect(isValidCPF('52998224724')).toBe(false);
    expect(isValidCPF('11111111111')).toBe(false);
    expect(isValidCNPJ('11444777000161')).toBe(true);
    expect(isValidCNPJ('11444777000162')).toBe(false);
  });
  it('gera CPF/CNPJ válidos', () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidCPF(generateCPF())).toBe(true);
      expect(isValidCNPJ(generateCNPJ())).toBe(true);
    }
  });
});

describe('NF-e', () => {
  it('monta chave de acesso de 44 dígitos com DV módulo 11', () => {
    const key = buildAccessKey({ uf: 'SP', date: new Date(2026, 9, 16), cnpj: '11444777000161', model: 55, series: 1, number: 123, code: '12345678' });
    expect(key).toHaveLength(44);
    expect(key.startsWith('352610')).toBe(true);
    expect(isValidAccessKey(key)).toBe(true);
    const tampered = key.slice(0, 43) + String((Number(key[43]) + 1) % 10);
    expect(isValidAccessKey(tampered)).toBe(false);
  });
  it('tpEmis 9 (contingência) aparece na posição 35', () => {
    const key = buildAccessKey({ uf: 'SP', date: new Date(), cnpj: '11444777000161', model: 65, series: 1, number: 1, code: '00000001', tpEmis: 9 });
    expect(key[34]).toBe('9');
    expect(isValidAccessKey(key)).toBe(true);
  });
  it('alíquota interestadual de ICMS', () => {
    expect(interstateIcmsRate('SP', 'RJ')).toBe(12);
    expect(interstateIcmsRate('SP', 'BA')).toBe(7);
    expect(interstateIcmsRate('BA', 'SP')).toBe(12);
    expect(interstateIcmsRate('SP', 'RJ', 1)).toBe(4); // importado (Res. SF 13/2012)
  });
});

describe('pagamentos', () => {
  it('Pix BR Code com CRC16 válido', () => {
    const p = buildPixPayload({ key: '11444777000161', name: 'Moda Brasil', city: 'SAO PAULO', amount: 10.5, txid: 'abc123' });
    expect(p.startsWith('000201')).toBe(true);
    expect(p).toContain('br.gov.bcb.pix');
    expect(p).toContain('540510.50');
    // recalcula o CRC16-CCITT
    const body = p.slice(0, -4);
    let crc = 0xffff;
    for (const ch of body) {
      crc ^= ch.charCodeAt(0) << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    expect(p.slice(-4)).toBe(crc.toString(16).toUpperCase().padStart(4, '0'));
  });
  it('boleto: linha digitável de 47 dígitos e código de barras de 44', () => {
    const b = buildBoleto({ bankCode: '001', amount: 150.75, dueDate: new Date(2026, 10, 20), ourNumber: '12345678901' });
    expect(b.barcode).toHaveLength(44);
    expect(b.line.replace(/\D/g, '')).toHaveLength(47);
    expect(b.barcode.slice(9, 19)).toBe('0000015075'); // posições 10–19: valor
    expect(b.line.endsWith('0000015075')).toBe(true);
  });
  it('EAN-13 com dígito verificador', () => {
    expect(buildEan13('789100000001')).toBe('7891000000014');
  });
});
