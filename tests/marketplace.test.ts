/**
 * Marketplaces reais: assinaturas, mapeamento de pedidos e tokens, sem rede (setHttpMock).
 * O último bloco usa o banco: RUN_DB_TESTS=1 npx vitest run tests/marketplace.test.ts
 */
import crypto from 'crypto';
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { setHttpMock, type HttpRequest } from '@/server/integrations/http';
import { getProvider } from '@/server/integrations/registry';
import type { AccountCtx } from '@/server/integrations/types';
import { mapMlOrder, mapMlItem, mlRefresh } from '@/server/integrations/providers/mercadolivre';
import { shopeeSign, shopeeUrl, verifyShopeePush, mapShopeeOrder } from '@/server/integrations/providers/shopee';
import { verifyShopifyHmac, mapShopifyOrder, shopDomain } from '@/server/integrations/providers/shopify';
import { verifyWooSignature, mapWooOrder } from '@/server/integrations/providers/woocommerce';
import { mapNuvemshopOrder } from '@/server/integrations/providers/nuvemshop';
import { splitStreet, toUf, joinExternal } from '@/server/services/marketplace/mappers';

const acc = (over: Partial<AccountCtx> = {}): AccountCtx => ({
  id: 'acc_test', companyId: 'cmp_test', provider: 'MERCADO_LIVRE', environment: 'PRODUCAO', status: 'CONECTADO',
  secrets: { accessToken: 'APP_USR-123', refreshToken: 'TG-abc' }, settings: {}, externalAccountId: '987654321', accountName: 'LOJA_TESTE', tokenExpiresAt: null, ...over,
});

// ---------------------------------------------------------------------------
// Exemplos fiéis às respostas da API do Mercado Livre
// ---------------------------------------------------------------------------
const ML_ORDER = {
  id: 2000009876543210,
  date_created: '2026-10-15T10:21:07.000-04:00',
  date_closed: '2026-10-15T10:21:09.000-04:00',
  last_updated: '2026-10-15T10:25:00.000-04:00',
  status: 'paid',
  status_detail: null,
  pack_id: 2000005555555555,
  currency_id: 'BRL',
  total_amount: 259.7,
  paid_amount: 284.6,
  order_items: [
    { item: { id: 'MLB3456789012', title: 'Boné Aba Curva Premium', category_id: 'MLB1234', variation_id: null, seller_custom_field: null, seller_sku: 'BON-ABA-01', variation_attributes: [] }, quantity: 2, unit_price: 79.9, full_unit_price: 89.9, currency_id: 'BRL', sale_fee: 11.19, listing_type_id: 'gold_special' },
    { item: { id: 'MLB3456789099', title: 'Camiseta Dry Fit', variation_id: 178945612301, seller_custom_field: null, seller_sku: 'CAM-DRY-AZ-M', variation_attributes: [{ id: 'COLOR', name: 'Cor', value_name: 'Azul' }, { id: 'SIZE', name: 'Tamanho', value_name: 'M' }] }, quantity: 1, unit_price: 99.9, full_unit_price: 99.9, currency_id: 'BRL', sale_fee: 16.98, listing_type_id: 'gold_pro' },
  ],
  payments: [{ id: 87654321012, order_id: 2000009876543210, status: 'approved', transaction_amount: 259.7, shipping_cost: 24.9, total_paid_amount: 284.6, installments: 3, payment_type: 'credit_card', payment_method_id: 'master' }],
  shipping: { id: 43215678901 },
  buyer: { id: 112233445, nickname: 'MARIASOUZA2024', first_name: 'Maria', last_name: 'Souza' },
  seller: { id: 987654321 },
  tags: ['paid', 'not_delivered', 'pack_order'],
  cancel_detail: null,
};

const ML_SHIPMENT = {
  id: 43215678901,
  order_id: 2000009876543210,
  status: 'ready_to_ship',
  substatus: 'ready_to_print',
  logistic_type: 'cross_docking',
  mode: 'me2',
  receiver_address: {
    id: 1234567890, address_line: 'Rua Barata Ribeiro 450', street_name: 'Rua Barata Ribeiro', street_number: '450', comment: 'Apto 802', zip_code: '22040002',
    city: { id: 'BR-RJ-01', name: 'Rio de Janeiro' }, state: { id: 'BR-RJ', name: 'Rio de Janeiro' }, country: { id: 'BR', name: 'Brasil' }, neighborhood: { id: null, name: 'Copacabana' },
    receiver_name: 'Maria Souza', receiver_phone: '21987654321',
  },
  shipping_option: { id: 123, name: 'Normal', cost: 24.9, list_cost: 24.9, currency_id: 'BRL' },
};

const ML_BILLING = {
  billing_info: {
    doc_type: 'CPF', doc_number: '52998224725',
    additional_info: [
      { type: 'FIRST_NAME', value: 'Maria' }, { type: 'LAST_NAME', value: 'Aparecida Souza' }, { type: 'STREET_NAME', value: 'Rua Barata Ribeiro' }, { type: 'STREET_NUMBER', value: '450' },
      { type: 'COMMENT', value: 'Apto 802' }, { type: 'NEIGHBORHOOD', value: 'Copacabana' }, { type: 'CITY_NAME', value: 'Rio de Janeiro' }, { type: 'STATE_NAME', value: 'Rio de Janeiro' }, { type: 'ZIP_CODE', value: '22040-002' },
    ],
  },
};

afterEach(() => setHttpMock(null));

describe('mapeadores comuns', () => {
  it('UF, logradouro e ID composto', () => {
    expect(toUf('BR-SP')).toBe('SP');
    expect(toUf('São Paulo')).toBe('SP');
    expect(toUf('rio grande do sul')).toBe('RS');
    expect(splitStreet('Rua X, 123 - Apto 4')).toEqual({ street: 'Rua X', number: '123', complement: 'Apto 4' });
    expect(splitStreet('Avenida Paulista 1000')).toMatchObject({ street: 'Avenida Paulista', number: '1000' });
    expect(splitStreet('Rua 7 de Setembro').number).toBeNull();
    expect(joinExternal('MLB1', null)).toBe('MLB1');
    expect(joinExternal('MLB1', 55)).toBe('MLB1/55');
  });
});

describe('Mercado Livre', () => {
  it('mapeia pedido pago com pacote, variação, CPF, endereço, frete e tarifa', () => {
    const o = mapMlOrder(ML_ORDER, ML_SHIPMENT, ML_BILLING);
    expect(o.externalId).toBe('2000009876543210');
    expect(o.packId).toBe('2000005555555555');
    expect(o.shipmentId).toBe('43215678901');
    expect(o.status).toBe('PAGO');
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({ sku: 'BON-ABA-01', externalItemId: 'MLB3456789012', variationId: null, quantity: 2, unitPrice: 79.9 });
    expect(o.items[1]).toMatchObject({ sku: 'CAM-DRY-AZ-M', variationId: '178945612301', title: 'Camiseta Dry Fit - Azul - M' });
    expect(o.buyer).toMatchObject({ name: 'Maria Aparecida Souza', document: '52998224725', nickname: 'MARIASOUZA2024' });
    expect(o.shipTo).toMatchObject({ name: 'Maria Souza', zip: '22040002', street: 'Rua Barata Ribeiro', number: '450', complement: 'Apto 802', district: 'Copacabana', city: 'Rio de Janeiro', uf: 'RJ' });
    expect(o.buyer.address).toMatchObject({ zip: '22040002', uf: 'RJ' });
    expect(o.freight).toBe(24.9);
    expect(o.fee).toBe(39.36); // 11,19 × 2 + 16,98
    expect(o.paymentLabel).toBe('Cartão de crédito em 3x');
  });

  it('cancelado e enviado', () => {
    expect(mapMlOrder({ ...ML_ORDER, status: 'cancelled' }).status).toBe('CANCELADO');
    expect(mapMlOrder({ ...ML_ORDER, status: 'payment_required' }).status).toBe('PENDENTE');
    expect(mapMlOrder(ML_ORDER, { ...ML_SHIPMENT, status: 'shipped' }).shipStatus).toBe('ENVIADO');
  });

  it('anúncio com variações vira um vínculo por variação (SELLER_SKU)', () => {
    const list = mapMlItem({
      id: 'MLB3456789099', title: 'Camiseta Dry Fit', price: 99.9, available_quantity: 7, status: 'active', listing_type_id: 'gold_pro', permalink: 'https://produto.mercadolivre.com.br/MLB-3456789099',
      variations: [
        { id: 178945612301, price: 99.9, available_quantity: 3, attribute_combinations: [{ value_name: 'Azul' }, { value_name: 'M' }], attributes: [{ id: 'SELLER_SKU', value_name: 'CAM-DRY-AZ-M' }] },
        { id: 178945612302, price: 99.9, available_quantity: 0, attribute_combinations: [{ value_name: 'Azul' }, { value_name: 'G' }], seller_custom_field: 'CAM-DRY-AZ-G' },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ externalId: 'MLB3456789099/178945612301', sku: 'CAM-DRY-AZ-M', stock: 3, status: 'ATIVO', listingType: 'Premium' });
    expect(list[1]).toMatchObject({ sku: 'CAM-DRY-AZ-G', status: 'SEM_ESTOQUE' });
  });

  it('renova o token (refresh_token de uso único)', async () => {
    const calls: HttpRequest[] = [];
    setHttpMock((req) => {
      calls.push(req);
      return { status: 200, data: { access_token: 'APP_USR-novo', token_type: 'Bearer', expires_in: 21600, scope: 'offline_access read write', user_id: 987654321, refresh_token: 'TG-novo' } };
    });
    process.env.ML_CLIENT_ID = '1234567890';
    process.env.ML_CLIENT_SECRET = 'segredo';
    const t = await mlRefresh(acc());
    expect(calls[0].url).toBe('https://api.mercadolibre.com/oauth/token');
    const body = calls[0].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('TG-abc');
    expect(body.get('client_id')).toBe('1234567890');
    expect(t).toMatchObject({ accessToken: 'APP_USR-novo', refreshToken: 'TG-novo', expiresIn: 21600, externalAccountId: '987654321' });
    expect(getProvider('MERCADO_LIVRE')?.oauth?.refresh).toBe(mlRefresh);
  });

  it('URL de autorização com PKCE e callback', async () => {
    const url = new URL(await getProvider('MERCADO_LIVRE')!.oauth!.authorizeUrl(acc(), 'estado123', 'https://erp.exemplo.com/api/oauth/mercado_livre/callback'));
    expect(url.origin + url.pathname).toBe('https://auth.mercadolivre.com.br/authorization');
    expect(url.searchParams.get('state')).toBe('estado123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('Shopee', () => {
  it('assina partner_id + path + timestamp (+ access_token + shop_id)', () => {
    const key = 'chave-parceiro';
    const base = '2001887/api/v2/order/get_order_list1700000000tokenABC123456';
    expect(shopeeSign(key, 2001887, '/api/v2/order/get_order_list', 1700000000, 'tokenABC', 123456)).toBe(crypto.createHmac('sha256', key).update(base).digest('hex'));
    process.env.SHOPEE_PARTNER_ID = '2001887';
    process.env.SHOPEE_PARTNER_KEY = key;
    const u = new URL(shopeeUrl(acc({ provider: 'SHOPEE', secrets: { accessToken: 'tokenABC' }, externalAccountId: '123456' }), '/api/v2/order/get_order_list', { page_size: 100 }, true, 1700000000));
    expect(u.origin).toBe('https://partner.shopeemobile.com');
    expect(u.searchParams.get('sign')).toBe(crypto.createHmac('sha256', key).update(base).digest('hex'));
    expect(u.searchParams.get('shop_id')).toBe('123456');
    expect(u.searchParams.get('page_size')).toBe('100');
    // Chamadas de autorização não levam token nem loja
    const a = new URL(shopeeUrl(acc({ environment: 'SANDBOX' }), '/api/v2/auth/token/get', {}, false, 1700000000));
    expect(a.origin).toBe('https://partner.test-stable.shopeemobile.com');
    expect(a.searchParams.get('sign')).toBe(crypto.createHmac('sha256', key).update('2001887/api/v2/auth/token/get1700000000').digest('hex'));
    expect(a.searchParams.has('access_token')).toBe(false);
  });

  it('confere a assinatura do push', () => {
    const raw = JSON.stringify({ shop_id: 123456, code: 3, data: { ordersn: '241016ABCDEF', status: 'READY_TO_SHIP' }, timestamp: 1700000000 });
    const url = 'https://erp.exemplo.com/api/hooks/shopee';
    const sig = crypto.createHmac('sha256', 'k').update(`${url}|${raw}`).digest('hex');
    expect(verifyShopeePush('k', url, raw, sig)).toBe(true);
    expect(verifyShopeePush('k', url, raw + ' ', sig)).toBe(false);
  });

  it('mapeia pedido (frete = total − itens)', () => {
    const o = mapShopeeOrder({
      order_sn: '241016ABCDEF', order_status: 'READY_TO_SHIP', create_time: 1760600000, total_amount: 115.8, buyer_username: 'comprador', buyer_cpf_id: '529.982.247-25',
      recipient_address: { name: 'João Lima', phone: '5511999998888', town: '', district: 'Bela Vista', city: 'São Paulo', state: 'São Paulo', zipcode: '01310-100', full_address: 'Avenida Paulista, 1000, Bela Vista, São Paulo, SP, 01310-100' },
      item_list: [{ item_id: 111, item_name: 'Boné', item_sku: 'BON-ABA-01', model_id: 0, model_name: '', model_sku: '', model_quantity_purchased: 1, model_original_price: 99.9, model_discounted_price: 99.9 }],
    });
    expect(o).toMatchObject({ externalId: '241016ABCDEF', status: 'PAGO', freight: 15.9 });
    expect(o.items[0]).toMatchObject({ sku: 'BON-ABA-01', variationId: null });
    expect(o.buyer.document).toBe('52998224725');
    expect(o.shipTo).toMatchObject({ street: 'Avenida Paulista', number: '1000', uf: 'SP', zip: '01310100' });
  });
});

describe('Shopify / WooCommerce / Nuvemshop', () => {
  const raw = JSON.stringify({ id: 820982911946154500, name: '#1001', line_items: [] });
  it('HMAC base64 do Shopify', () => {
    const sig = crypto.createHmac('sha256', 'shpss_segredo').update(raw, 'utf8').digest('base64');
    expect(verifyShopifyHmac('shpss_segredo', raw, sig)).toBe(true);
    expect(verifyShopifyHmac('outro', raw, sig)).toBe(false);
    expect(verifyShopifyHmac('shpss_segredo', raw, null)).toBe(false);
    expect(shopDomain('https://MinhaLoja.myshopify.com/admin')).toBe('minhaloja.myshopify.com');
    expect(shopDomain('minhaloja')).toBe('minhaloja.myshopify.com');
  });
  it('HMAC base64 do WooCommerce', () => {
    const sig = crypto.createHmac('sha256', 'wc-secret').update(raw, 'utf8').digest('base64');
    expect(verifyWooSignature('wc-secret', raw, sig)).toBe(true);
    expect(verifyWooSignature('wc-secret', raw.replace('1001', '1002'), sig)).toBe(false);
  });
  it('pedidos Shopify, Woo e Nuvemshop', () => {
    const s = mapShopifyOrder({
      id: 5001, name: '#1001', financial_status: 'paid', cancelled_at: null, email: 'ana@ex.com', total_discounts: '10.00',
      customer: { first_name: 'Ana', last_name: 'Lima' }, note_attributes: [{ name: 'CPF', value: '529.982.247-25' }],
      shipping_address: { name: 'Ana Lima', address1: 'Rua Augusta, 500', address2: 'Consolação', city: 'São Paulo', province_code: 'SP', zip: '01305-000' },
      line_items: [{ product_id: 1, variant_id: 2, sku: 'BON-ABA-01', title: 'Boné', quantity: 2, price: '89.90' }], shipping_lines: [{ title: 'PAC', price: '20.00' }],
    });
    expect(s).toMatchObject({ externalId: '5001', number: '#1001', status: 'PAGO', freight: 20, discount: 10 });
    expect(s.buyer.document).toBe('52998224725');
    expect(s.shipTo).toMatchObject({ street: 'Rua Augusta', number: '500', district: 'Consolação', uf: 'SP' });

    const w = mapWooOrder({
      id: 727, number: '727', status: 'processing', shipping_total: '15.00',
      billing: { first_name: 'Carlos', last_name: 'Dias', email: 'c@ex.com', cpf: '529.982.247-25', address_1: 'Rua das Flores', number: '12', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', postcode: '80020-000' },
      shipping: {}, line_items: [{ product_id: 9, variation_id: 0, sku: 'BON-ABA-01', name: 'Boné', quantity: 2, subtotal: '200.00', total: '180.00', price: 90 }],
    });
    expect(w).toMatchObject({ status: 'PAGO', freight: 15 });
    expect(w.items[0]).toMatchObject({ unitPrice: 100, discount: 20 });
    expect(w.shipTo).toMatchObject({ street: 'Rua das Flores', number: '12', district: 'Centro', uf: 'PR' });
    expect(mapWooOrder({ id: 1, status: 'cancelled', billing: {}, line_items: [] }).status).toBe('CANCELADO');

    const n = mapNuvemshopOrder({
      id: 445566, number: 312, status: 'open', payment_status: 'paid', shipping_status: 'unpacked', contact_identification: '52998224725', contact_email: 'b@ex.com',
      customer: { name: 'Beatriz Rocha' }, shipping_cost_customer: '18.50', discount: '0.00',
      shipping_address: { name: 'Beatriz Rocha', address: 'Rua XV de Novembro', number: '700', floor: 'Sala 2', locality: 'Centro', city: 'Curitiba', province: 'Paraná', zipcode: '80020310' },
      products: [{ product_id: 10, variant_id: 20, name: 'Boné', price: '99.90', quantity: 1, sku: 'BON-ABA-01' }],
    });
    expect(n).toMatchObject({ externalId: '445566', number: '#312', status: 'PAGO', freight: 18.5 });
    expect(n.shipTo).toMatchObject({ uf: 'PR', number: '700', complement: 'Sala 2' });
    expect(n.items[0]).toMatchObject({ externalItemId: '10', variationId: '20' });
  });
});

// ---------------------------------------------------------------------------
// Banco: importa pedido do ML (API simulada pelo mock) sem duplicar e cancela
// ---------------------------------------------------------------------------
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('importação real de pedido ML (banco)', () => {
  let prisma: typeof import('@/lib/db').prisma;
  let sync: typeof import('@/server/services/marketplace/sync');
  let actor: { companyId: string; orgId: string; userName: string };
  let channelId: string;
  const orderId = Number(`20000${Date.now()}`.slice(0, 16));

  beforeAll(async () => {
    prisma = (await import('@/lib/db')).prisma;
    sync = await import('@/server/services/marketplace/sync');
    const company = await prisma.company.findFirstOrThrow({ where: { cnpj: '11444777000161' } });
    actor = { companyId: company.id, orgId: company.organizationId, userName: 'Teste marketplace' };
    const ch = await prisma.salesChannel.create({ data: { companyId: company.id, provider: 'MERCADO_LIVRE', name: 'Mercado Livre (teste)', status: 'CONECTADO', feePercent: 14, config: { realAccountId: 'acc_teste_db' } } });
    channelId = ch.id;
  });

  afterAll(async () => {
    setHttpMock(null);
    if (channelId) await prisma.salesChannel.delete({ where: { id: channelId } }).catch(() => {});
  });

  function mock(status: string) {
    setHttpMock((req) => {
      const u = new URL(req.url);
      if (u.pathname === '/orders/search') return { data: { results: [{ ...ML_ORDER, id: orderId, status }], paging: { total: 1, offset: 0, limit: 50 } } };
      if (u.pathname === `/shipments/${ML_SHIPMENT.id}`) return { data: { ...ML_SHIPMENT, order_id: orderId } };
      if (u.pathname === `/orders/${orderId}/billing_info`) return { data: ML_BILLING };
      return { status: 404, data: { message: 'not_found' } };
    });
  }

  it('importa uma vez, não duplica e cancela quando o ML cancela', async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { organizationId: actor.orgId, sku: 'BON-ABA-01' } });
    // A variação do exemplo não existe no seed: vincula o anúncio da camiseta a um produto qualquer pelo ID do anúncio
    const other = await prisma.product.findFirstOrThrow({ where: { organizationId: actor.orgId, kind: 'SIMPLES', active: true, id: { not: product.id } } });
    await prisma.listing.create({ data: { channelId, productId: other.id, externalId: 'MLB3456789099/178945612301', title: 'Camiseta Dry Fit', price: 99.9 } });

    const a = acc({ companyId: actor.companyId });
    let ch = await prisma.salesChannel.findUniqueOrThrow({ where: { id: channelId } });
    mock('paid');
    const first = await sync.realImportOrders(actor, ch, a);
    expect(first.created).toHaveLength(1);
    const order = await prisma.salesOrder.findFirstOrThrow({ where: { channelId, externalId: String(orderId) }, include: { items: true, customer: true } });
    expect(order.origin).toBe('INTEGRACAO');
    expect(order.items).toHaveLength(2);
    expect(order.items.find((i) => i.productId === product.id)?.quantity).toBe(2);
    expect(order.freight).toBe(24.9);
    expect(order.total).toBe(284.6);
    expect(order.channelFee).toBe(39.36);
    expect(order.customer.document).toBe('52998224725');
    expect((order.shipTo as any).ref.packId).toBe('2000005555555555');

    ch = await prisma.salesChannel.findUniqueOrThrow({ where: { id: channelId } });
    const second = await sync.realImportOrders(actor, ch, a);
    expect(second.created).toHaveLength(0);
    expect(second.results[0].action).toBe('EXISTENTE');
    expect(await prisma.salesOrder.count({ where: { channelId, externalId: String(orderId) } })).toBe(1);

    mock('cancelled');
    const third = await sync.realImportOrders(actor, ch, a);
    expect(third.results[0].action).toBe('ATUALIZADO');
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELADO');
  });
});
