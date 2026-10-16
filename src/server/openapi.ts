/** Especificação OpenAPI 3.0 da API REST pública do GestãoPro */
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'GestãoPro API',
    version: '1.0.0',
    description: 'API REST para integrações externas (ERP, e-commerce, BI). Autentique com `Authorization: Bearer <chave>` gerada em Integrações > API e Webhooks. Ambiente de demonstração: chave `gp_live_demo_0123456789abcdef` (empresa Moda Brasil).',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Product: { type: 'object', properties: { id: { type: 'string' }, sku: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, costPrice: { type: 'number' }, gtin: { type: 'string' }, ncm: { type: 'string' }, kind: { type: 'string' }, stock: { type: 'object', properties: { quantity: { type: 'number' }, reserved: { type: 'number' }, available: { type: 'number' } } } } },
      OrderInput: { type: 'object', required: ['customer', 'items'], properties: { externalId: { type: 'string' }, customer: { type: 'object', properties: { document: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, zip: { type: 'string' }, city: { type: 'string' }, uf: { type: 'string' } } }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: 'number' } } } }, freight: { type: 'number' }, paymentMethod: { type: 'string', enum: ['BOLETO', 'PIX', 'CARTAO_CREDITO', 'DINHEIRO', 'MARKETPLACE'] } } },
      Error: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/products': {
      get: { summary: 'Listar produtos com saldo', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista paginada de produtos' } } },
      post: { summary: 'Criar produto', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } }, responses: { 200: { description: 'Produto criado' } } },
    },
    '/products/{sku}': {
      get: { summary: 'Consultar produto por SKU ou ID', parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Produto' }, 404: { description: 'Não encontrado' } } },
      patch: { summary: 'Atualizar preço/dados do produto (dispara sincronização com canais)', parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Produto atualizado' } } },
    },
    '/stock': {
      get: { summary: 'Saldos de estoque', parameters: [{ name: 'sku', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Saldos por produto' } } },
      post: { summary: 'Lançar movimentação de estoque', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { sku: { type: 'string' }, type: { type: 'string', enum: ['ENTRADA', 'SAIDA', 'AJUSTE'] }, quantity: { type: 'number' }, notes: { type: 'string' } } } } } }, responses: { 200: { description: 'Movimentação registrada' } } },
    },
    '/orders': {
      get: { summary: 'Listar pedidos de venda', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'since', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { 200: { description: 'Pedidos' } } },
      post: { summary: 'Criar pedido de venda (reserva estoque automaticamente)', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderInput' } } } }, responses: { 200: { description: 'Pedido criado' } } },
    },
    '/orders/{id}': { get: { summary: 'Consultar pedido', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Pedido com itens' } } } },
    '/orders/{id}/invoice': { post: { summary: 'Faturar pedido (emite NF-e simulada)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Resultado do faturamento' } } } },
    '/orders/{id}/cancel': { post: { summary: 'Cancelar pedido', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cancelado' } } } },
    '/contacts': {
      get: { summary: 'Listar contatos', parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['CLIENTE', 'FORNECEDOR', 'TRANSPORTADORA'] } }], responses: { 200: { description: 'Contatos' } } },
      post: { summary: 'Criar contato', responses: { 200: { description: 'Contato criado' } } },
    },
    '/invoices': { get: { summary: 'Listar notas fiscais', responses: { 200: { description: 'Notas' } } } },
    '/receivables': { get: { summary: 'Contas a receber em aberto', responses: { 200: { description: 'Títulos' } } } },
  },
  'x-webhooks': {
    events: ['order.created', 'order.invoiced', 'order.cancelled', 'order.shipped', 'order.delivered', 'invoice.authorized', 'invoice.cancelled', 'stock.changed', 'product.price_changed', 'purchase.received', 'receivable.paid', 'payable.paid', 'shipment.posted', 'shipment.delivered', 'contact.created'],
    signature: 'Header X-GestaoPro-Signature = HMAC-SHA256(secret, body)',
  },
};
