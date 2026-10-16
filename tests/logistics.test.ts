import { describe, it, expect, afterEach } from 'vitest';
import { setHttpMock, type HttpRequest } from '@/server/integrations/http';
import { mapMeQuote, meQuote, meBuyLabel, meCartBody, meStatus, type ShipPurchase } from '@/server/integrations/providers/melhorenvio';
import { mapCorreiosQuote, mapCorreiosTracking, correiosTracking, correiosPrePostBody } from '@/server/integrations/providers/correios';
import { quoteFreight } from '@/server/services/logistics';
import type { AccountCtx } from '@/server/integrations/types';

const acc = (provider: string, secrets: Record<string, string>, settings: Record<string, any> = {}): AccountCtx => ({
  id: '', companyId: 'empresa-teste', provider, environment: 'SANDBOX', status: 'CONECTADO', secrets, settings, externalAccountId: null, accountName: null, tokenExpiresAt: null,
});

const ME_QUOTE = [
  { id: 1, name: 'PAC', price: '23.45', custom_price: '21.90', delivery_time: 7, custom_delivery_time: 8, company: { id: 1, name: 'Correios' } },
  { id: 2, name: 'SEDEX', price: '41.20', delivery_time: 2, company: { id: 1, name: 'Correios' } },
  { id: 3, name: '.Package', error: 'Serviço indisponível para o trecho.', company: { id: 2, name: 'Jadlog' } },
];

const purchase: ShipPurchase = {
  serviceId: '1',
  from: { name: 'Loja Exemplo', phone: '(11) 3333-4444', email: 'loja@ex.com', document: '11.444.777/0001-61', ie: '123', street: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', uf: 'SP', zip: '01001-000' },
  to: { name: 'Maria', phone: '(21) 99999-8888', email: 'maria@ex.com', document: '529.982.247-25', street: 'Rua B', number: '20', district: 'Botafogo', city: 'Rio de Janeiro', uf: 'RJ', zip: '22250-040' },
  products: [{ name: 'Camiseta', quantity: 2, unitValue: 49.9 }],
  volume: { weight: 0.6, height: 5, width: 15, length: 20 },
  value: 99.8,
  invoiceKey: '35261011444777000161550010000015301000015309',
  invoiceNumber: 1530,
  orderNumber: 1024,
};

afterEach(() => setHttpMock(null));

describe('Melhor Envio', () => {
  it('mapeia a cotação (preço personalizado, prazo, ignora serviços com erro)', () => {
    const opts = mapMeQuote(ME_QUOTE);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ provider: 'MELHOR_ENVIO', carrier: 'Correios', service: 'PAC', serviceId: '1', price: 21.9, deadlineDays: 8, simulated: false });
    expect(opts[1].price).toBe(41.2);
  });

  it('cota com Bearer + User-Agent obrigatório e pacote/seguro', async () => {
    const calls: HttpRequest[] = [];
    setHttpMock((r) => (calls.push(r), { status: 200, data: ME_QUOTE }));
    const opts = await meQuote(acc('MELHOR_ENVIO', { token: 'tok123' }, { email: 'dev@loja.com' }), { fromZip: '01001-000', toZip: '22250-040', weight: 0.5, value: 150 });
    expect(opts).toHaveLength(2);
    expect(calls[0].url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    expect(calls[0].headers?.Authorization).toBe('Bearer tok123');
    expect(calls[0].headers?.['User-Agent']).toContain('(dev@loja.com)');
    const b = calls[0].body as any;
    expect(b.from.postal_code).toBe('01001000');
    expect(b.options.insurance_value).toBe(150);
    expect(b.package.weight).toBe(0.5);
  });

  it('compra a etiqueta: carrinho com NF-e → checkout → gerar → imprimir → rastreio', async () => {
    const calls: HttpRequest[] = [];
    setHttpMock((r) => {
      calls.push(r);
      const path = new URL(r.url).pathname;
      if (path.endsWith('/me/cart')) return { status: 201, data: { id: 'ord-abc', protocol: 'ORD-123', price: 21.9, status: 'pending' } };
      if (path.endsWith('/checkout')) return { data: { purchase: { id: 'p1', status: 'paid' } } };
      if (path.endsWith('/generate')) return { data: { 'ord-abc': { status: true, message: 'Envio gerado' } } };
      if (path.endsWith('/print')) return { data: { url: 'https://sandbox.melhorenvio.com.br/imprimir/xyz' } };
      if (path.endsWith('/tracking')) return { data: { 'ord-abc': { id: 'ord-abc', status: 'released', tracking: 'QB123456785BR' } } };
      return { status: 404, data: { message: 'rota' } };
    });
    const r = await meBuyLabel(acc('MELHOR_ENVIO', { token: 't' }, { email: 'a@b.c' }), purchase);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v2/me/cart', '/api/v2/me/shipment/checkout', '/api/v2/me/shipment/generate', '/api/v2/me/shipment/print', '/api/v2/me/shipment/tracking']);
    const cart = calls[0].body as any;
    expect(cart.service).toBe(1);
    expect(cart.options.invoice.key).toBe(purchase.invoiceKey);
    expect(cart.options.non_commercial).toBe(false);
    expect(cart.from.company_document).toBe('11444777000161');
    expect(cart.to.document).toBe('52998224725');
    expect(cart.products[0]).toEqual({ name: 'Camiseta', quantity: 2, unitary_value: 49.9 });
    expect((calls[1].body as any).orders).toEqual(['ord-abc']);
    expect(r).toMatchObject({ providerRef: 'ord-abc', trackingCode: 'QB123456785BR', labelUrl: 'https://sandbox.melhorenvio.com.br/imprimir/xyz', price: 21.9 });
  });

  it('sem NF-e o envio é declarado como não comercial', () => {
    expect(meCartBody({ settings: {} }, { ...purchase, invoiceKey: null }).options.non_commercial).toBe(true);
  });

  it('status do Melhor Envio → status do envio', () => {
    expect(meStatus('posted')).toBe('POSTADO');
    expect(meStatus('delivered')).toBe('ENTREGUE');
    expect(meStatus('released')).toBeNull();
  });
});

const SRO = {
  objetos: [{
    codObjeto: 'QB123456785BR',
    eventos: [
      { codigo: 'BDE', tipo: '01', dtHrCriado: '2026-10-14T15:20:00', descricao: 'Objeto entregue ao destinatário', unidade: { tipo: 'Unidade de Distribuição', endereco: { cidade: 'RIO DE JANEIRO', uf: 'RJ' } } },
      { codigo: 'OEC', tipo: '01', dtHrCriado: '2026-10-14T08:02:00', descricao: 'Objeto saiu para entrega ao destinatário', unidade: { tipo: 'Unidade de Distribuição', endereco: { cidade: 'RIO DE JANEIRO', uf: 'RJ' } } },
      { codigo: 'RO', tipo: '01', dtHrCriado: '2026-10-12T22:10:00', descricao: 'Objeto em trânsito - por favor aguarde', unidade: { tipo: 'Unidade de Tratamento', endereco: { cidade: 'SAO PAULO', uf: 'SP' } }, unidadeDestino: { endereco: { cidade: 'RIO DE JANEIRO', uf: 'RJ' } } },
      { codigo: 'PO', tipo: '01', dtHrCriado: '2026-10-12T10:00:00', descricao: 'Objeto postado', unidade: { tipo: 'Agência dos Correios', endereco: { cidade: 'SAO PAULO', uf: 'SP' } } },
    ],
  }],
};

describe('Correios', () => {
  it('rastreio SRO → eventos em ordem cronológica e status atual', () => {
    const t = mapCorreiosTracking(SRO);
    expect(t.status).toBe('ENTREGUE');
    expect(t.events.map((e) => e.status)).toEqual(['POSTADO', 'EM_TRANSITO', 'SAIU_PARA_ENTREGA', 'ENTREGUE']);
    expect(t.events[1].description).toContain('para RIO DE JANEIRO/RJ');
    expect(t.events[0].location).toBe('Agência dos Correios - SAO PAULO/SP');
  });

  it('autentica no cartão de postagem (Basic) e consulta /srorastro com Bearer', async () => {
    const calls: HttpRequest[] = [];
    setHttpMock((r) => {
      calls.push(r);
      if (r.url.includes('/token/v1/autentica/cartaopostagem')) return { status: 201, data: { token: 'jwt-correios', expiraEm: new Date(Date.now() + 3600_000).toISOString() } };
      return { data: SRO };
    });
    const t = await correiosTracking(acc('CORREIOS', { codigoAcesso: 'segredo' }, { usuario: 'loja', cartao: '0067599079' }), 'QB123456785BR');
    expect(calls[0].url).toBe('https://apihom.correios.com.br/token/v1/autentica/cartaopostagem');
    expect(calls[0].headers?.Authorization).toBe(`Basic ${Buffer.from('loja:segredo').toString('base64')}`);
    expect((calls[0].body as any).numero).toBe('0067599079');
    expect(calls[1].url).toBe('https://apihom.correios.com.br/srorastro/v1/objetos/QB123456785BR?resultado=T');
    expect(calls[1].headers?.Authorization).toBe('Bearer jwt-correios');
    expect(t.events).toHaveLength(4);
  });

  it('preço/prazo do contrato (valores com vírgula) e corpo da pré-postagem', () => {
    expect(mapCorreiosQuote('03220', { pcFinal: '1.025,80' }, { prazoEntrega: 2 })).toMatchObject({ service: 'SEDEX', price: 1025.8, deadlineDays: 2, serviceId: '03220' });
    const b = correiosPrePostBody({ settings: { usuario: 'loja', cartao: '0067599079' } }, { ...purchase, serviceId: '03298' }) as any;
    expect(b.codigoServico).toBe('03298');
    expect(b.chaveNFe).toBe(purchase.invoiceKey);
    expect(b.pesoInformado).toBe('600');
    expect(b.destinatario.endereco.cep).toBe('22250040');
    expect(b.destinatario.dddCelular).toBe('21');
  });
});

describe('simulação (sem conta conectada)', () => {
  it('mantém as opções simuladas', () => {
    const o = quoteFreight({ fromZip: '01001000', toZip: '22250040', weight: 1 });
    expect(o.length).toBe(8);
    expect(o.every((x) => x.simulated)).toBe(true);
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('cotação com conta conectada (banco)', () => {
  it('sem conta usa a simulação; com Melhor Envio conectado usa as opções reais', async () => {
    const { prisma } = await import('@/lib/db');
    const { quoteFreightDetailed } = await import('@/server/services/logistics');
    const { saveCredentials } = await import('@/server/integrations/accounts');
    const company = await prisma.company.findFirst({ where: { cnpj: '11444777000161' } });
    const before = await prisma.integrationAccount.findUnique({ where: { companyId_provider: { companyId: company!.id, provider: 'MELHOR_ENVIO' } } });
    if (before?.status === 'CONECTADO') return; // ambiente com conta real: não mexe
    const params = { fromZip: company!.zip || '01001000', toZip: '22250040', weight: 1, value: 100 };
    const sim = await quoteFreightDetailed(company!.id, params);
    expect(sim.real).toBe(false);
    try {
      const acc = await saveCredentials(company!.id, 'MELHOR_ENVIO', { environment: 'SANDBOX', values: { token: 'tok', email: 'dev@loja.com' } });
      await prisma.integrationAccount.update({ where: { id: acc.id }, data: { status: 'CONECTADO' } });
      setHttpMock(() => ({ status: 200, data: ME_QUOTE }));
      const real = await quoteFreightDetailed(company!.id, params);
      expect(real.real).toBe(true);
      expect(real.options.map((o) => o.service)).toEqual(['PAC', 'SEDEX']);
      setHttpMock(() => ({ status: 401, data: { message: 'Unauthenticated.' } }));
      const failed = await quoteFreightDetailed(company!.id, params);
      expect(failed.real).toBe(false); // falha do provedor: segue com a simulação e informa o erro
      expect(failed.errors[0]).toContain('Unauthenticated');
    } finally {
      if (before) await prisma.integrationAccount.update({ where: { id: before.id }, data: { status: before.status, secrets: before.secrets, settings: before.settings as object, environment: before.environment } });
      else await prisma.integrationAccount.deleteMany({ where: { companyId: company!.id, provider: 'MELHOR_ENVIO' } });
    }
  });
});
