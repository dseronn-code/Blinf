import { describe, it, expect } from 'vitest';
import { cnabRetornoSample } from '@/server/services/financeExtras';
import { totp, verifyTotp, base32Encode, base32Decode, generateSecret } from '@/lib/totp';
import { rateLimit } from '@/lib/rateLimit';

describe('CNAB 400', () => {
  it('retorno de exemplo tem linhas de 400 posições com header/trailer', () => {
    const detail = '1'.padEnd(37, ' ') + 'ENTRYID'.padEnd(25, ' ') + '        ' + '000000012345' + ''.padEnd(44, ' ') + '0000000015075';
    const remessa = ['0' + '1REMESSA'.padEnd(399, ' '), detail.padEnd(400, ' '), detail.padEnd(400, ' '), detail.padEnd(400, ' '), '9'.padEnd(400, ' ')].join('\r\n');
    const ret = cnabRetornoSample(remessa).split('\r\n').filter(Boolean);
    expect(ret[0].startsWith('02RETORNO')).toBe(true);
    expect(ret.every((l) => l.length === 400)).toBe(true);
    expect(ret.filter((l) => l.startsWith('1'))).toHaveLength(3);
    expect(ret[ret.length - 1].startsWith('9')).toBe(true);
    // 2 de 3 liquidados (ocorrência 06)
    expect(ret.filter((l) => l.slice(108, 110) === '06')).toHaveLength(2);
  });
});

describe('2FA TOTP (RFC 6238)', () => {
  it('vetor de teste RFC 6238 (SHA1, T=59s)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totp(secret, 59 * 1000)).toBe('287082'); // 94287082 → 6 dígitos
  });
  it('aceita janela ±30 s e rejeita código errado', () => {
    const s = generateSecret();
    const now = Date.now();
    expect(verifyTotp(s, totp(s, now - 30000), now)).toBe(true);
    expect(verifyTotp(s, '000000', now) && totp(s, now) !== '000000').toBe(false);
  });
});

describe('rate limit', () => {
  it('bloqueia após o limite', () => {
    const key = 'teste-' + Math.random();
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 1000).ok).toBe(true);
    expect(rateLimit(key, 3, 1000).ok).toBe(false);
  });
});
