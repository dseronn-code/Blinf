import { describe, it, expect } from 'vitest';
import { calcItemTaxes } from '@/server/services/fiscal';

const venda = { cfopIntra: '5102', cfopInter: '6102', csosn: '102', icmsCst: '00', icmsRateIntra: 18, pisRate: 0.65, cofinsRate: 3, issRate: 5, kind: 'VENDA' };
const simples = { uf: 'SP', crt: 1, taxRegime: 'SIMPLES' };
const presumido = { uf: 'SP', crt: 3, taxRegime: 'PRESUMIDO' };
const item = { total: 1000, ipiRate: 10, origin: 0, isService: false };

describe('cálculo de impostos', () => {
  it('Simples Nacional: CSOSN, sem destaque de ICMS/IBS/CBS', () => {
    const t = calcItemTaxes(simples, venda, { uf: 'SP', contributor: true, finalConsumer: false }, item);
    expect(t.cst).toBe('102');
    expect(t.cfop).toBe('5102');
    expect(t.icmsValue).toBe(0);
    expect(t.cbsValue).toBe(0);
  });

  it('regime normal intraestadual: ICMS 18%, IPI, PIS/COFINS cumulativos, IBS/CBS informativos', () => {
    const t = calcItemTaxes(presumido, venda, { uf: 'SP', contributor: true, finalConsumer: false }, item);
    expect(t.cfop).toBe('5102');
    expect(t.icmsValue).toBe(180);
    expect(t.ipiValue).toBe(100);
    expect(t.pisValue).toBe(6.5);
    expect(t.cofinsValue).toBe(30);
    expect(t.cbsValue).toBe(9); // 0,9%
    expect(t.ibsValue).toBe(1); // 0,1%
  });

  it('interestadual para consumidor final não contribuinte: DIFAL + FCP (EC 87/2015)', () => {
    const t = calcItemTaxes(presumido, venda, { uf: 'RJ', contributor: false, finalConsumer: true }, item);
    expect(t.cfop).toBe('6102');
    expect(t.icmsRate).toBe(12);
    // base inclui IPI para consumidor final: 1100 × (alíquota interna RJ − 12%)
    expect(t.icmsBase).toBe(1100);
    expect(t.difalValue).toBeGreaterThan(0);
    expect(t.fcpValue).toBe(22); // FCP RJ 2%
  });

  it('interestadual para contribuinte: sem DIFAL', () => {
    const t = calcItemTaxes(presumido, venda, { uf: 'RJ', contributor: true, finalConsumer: false }, item);
    expect(t.difalValue).toBe(0);
  });

  it('ICMS-ST com MVA: CST 10 / CFOP 5403', () => {
    const t = calcItemTaxes(presumido, venda, { uf: 'SP', contributor: true, finalConsumer: false }, { ...item, mvaST: 40 });
    expect(t.cst).toBe('10');
    expect(t.cfop).toBe('5403');
    expect(t.icmsStBase).toBe(1540); // (1000 + 100 IPI) × 1,4
    expect(t.icmsStValue).toBe(round(1540 * 0.18 - 180));
  });

  it('ICMS-ST no Simples: CSOSN 202', () => {
    const t = calcItemTaxes(simples, venda, { uf: 'SP', contributor: true, finalConsumer: false }, { ...item, mvaST: 40 });
    expect(t.cst).toBe('202');
    expect(t.icmsStValue).toBeGreaterThan(0);
  });

  it('serviço: ISS', () => {
    const t = calcItemTaxes(simples, { ...venda, kind: 'SERVICO' }, { uf: 'SP', contributor: false, finalConsumer: true }, { total: 300, ipiRate: 0, origin: 0, isService: true });
    expect(t.issValue).toBe(15);
    expect(t.cfop).toBe('');
  });
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
