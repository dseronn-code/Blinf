import { describe, it, expect } from 'vitest';
import { generateDemoCertificate, readCertificate, signElement, verifySignature } from '@/server/services/cert';

describe('certificado A1 e assinatura XMLDSig', () => {
  const pfx = generateDemoCertificate('Empresa Teste Ltda', '11444777000161', 'senha123');

  it('abre o PKCS#12 com a senha e lê titular/CNPJ/validade', () => {
    const info = readCertificate(pfx, 'senha123');
    expect(info.cn).toContain('Empresa Teste Ltda');
    expect(info.cnpj).toBe('11444777000161');
    expect(info.notAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('recusa senha incorreta', () => {
    expect(() => readCertificate(pfx, 'errada')).toThrow();
  });

  it('assina e verifica; detecta adulteração', () => {
    const el = '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id="NFe35261011444777000161550010000001231000000010" versao="4.00"><ide><nNF>123</nNF></ide></infNFe>';
    const sig = signElement(el, 'NFe35261011444777000161550010000001231000000010', pfx, 'senha123');
    expect(sig).toContain('<SignatureValue>');
    expect(sig).toContain('<X509Certificate>');
    expect(verifySignature(el, sig)).toBe(true);
    expect(verifySignature(el.replace('<nNF>123', '<nNF>124'), sig)).toBe(false);
  });
}, 120000);
