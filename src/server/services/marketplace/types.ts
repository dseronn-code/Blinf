/**
 * Tipos comuns dos marketplaces/plataformas reais: cada provedor converte o
 * pedido e os anúncios do seu formato para estes, e o restante do fluxo
 * (cliente, itens por SKU, pedido de venda, sincronização) é compartilhado.
 */
import type { AccountCtx } from '@/server/integrations/types';

export type MkAddress = { name?: string | null; zip?: string | null; street?: string | null; number?: string | null; complement?: string | null; district?: string | null; city?: string | null; uf?: string | null; phone?: string | null };

export type MkBuyer = { name: string; document?: string | null; ie?: string | null; email?: string | null; phone?: string | null; nickname?: string | null; address?: MkAddress | null };

export type MkItem = {
  sku?: string | null;
  /** ID do anúncio/produto no canal e da variação (para localizar pelo vínculo do anúncio) */
  externalItemId?: string | null;
  variationId?: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
};

/** Situação normalizada: só pedidos PAGOS viram pedido de venda */
export type MkStatus = 'PAGO' | 'PENDENTE' | 'CANCELADO';

export type MkOrder = {
  externalId: string;
  /** Nº exibido ao lojista (ex.: #1001) quando difere do ID */
  number?: string | null;
  packId?: string | null;
  shipmentId?: string | null;
  date?: string | Date | null;
  status: MkStatus;
  shipStatus?: 'ENVIADO' | 'ENTREGUE' | null;
  buyer: MkBuyer;
  shipTo?: MkAddress | null;
  items: MkItem[];
  freight: number;
  discount: number;
  /** Tarifa real cobrada pelo canal (R$); null = usar o % do canal */
  fee?: number | null;
  installments?: number;
  paymentLabel?: string | null;
  carrier?: string | null;
  shippingService?: string | null;
  notes?: string | null;
};

export type MkListing = {
  /** ID do anúncio no canal; variações usam "item/variação" (ver joinExternal) */
  externalId: string;
  sku?: string | null;
  title: string;
  price: number;
  stock: number;
  /** ATIVO | PAUSADO | SEM_ESTOQUE | ENCERRADO */
  status: string;
  permalink?: string | null;
  listingType?: string | null;
};

/** Variação do anúncio a criar (produto filho VARIACAO do ERP) */
export type MkDraftVariation = { sku: string; gtin?: string | null; price: number; quantity: number; attributes: Record<string, string>; images?: string[] };

/** Anúncio a criar a partir do produto do ERP */
export type MkDraft = {
  orgId: string;
  title: string;
  description: string;
  sku: string;
  gtin?: string | null;
  brand?: string | null;
  price: number;
  quantity: number;
  /** URLs absolutas das imagens (ou data: URI) */
  images: string[];
  /** kg / cm */
  weight: number;
  width: number;
  height: number;
  length: number;
  /** ML: gold_special (Clássico) | gold_pro (Premium) */
  listingType?: string | null;
  categoryId?: string | null;
  /** Atributos do produto simples (ex.: {"Cor":"Azul"}) */
  attributes?: Record<string, string>;
  variations: MkDraftVariation[];
};

/** Dados da NF-e autorizada enviados ao canal */
export type MkInvoice = { xml: string; number: number; series: number; accessKey: string; issueDate: Date; total: number; productsTotal: number; cfop?: string | null; danfeUrl?: string | null };

export type MkCategory = { id: string; name: string; path?: string | null };

export type MarketplaceAdapter = {
  provider: string;
  /** Pedidos criados ou alterados desde a data */
  fetchOrders: (acc: AccountCtx, since: Date) => Promise<MkOrder[]>;
  /** Todos os anúncios/variações da conta (para vincular por SKU) */
  fetchListings: (acc: AccountCtx) => Promise<MkListing[]>;
  /** Envia estoque e/ou preço de um anúncio */
  pushListing: (acc: AccountCtx, externalId: string, data: { stock?: number; price?: number }) => Promise<void>;
  /** Envia a NF-e autorizada ao canal (XML no ML; dados fiscais nos demais) */
  uploadInvoice?: (acc: AccountCtx, ref: { externalId: string; packId?: string | null }, inv: MkInvoice) => Promise<void>;
  /** Cria o anúncio no canal; devolve um MkListing por variação (com o SKU do ERP) */
  createListing?: (acc: AccountCtx, draft: MkDraft) => Promise<MkListing[]>;
  /** Pausa/ativa e/ou altera o título do anúncio */
  editListing?: (acc: AccountCtx, externalId: string, data: { active?: boolean; title?: string }) => Promise<void>;
  /** Sugestão de categoria pelo título */
  suggestCategories?: (acc: AccountCtx, title: string) => Promise<MkCategory[]>;
};

const adapters = new Map<string, MarketplaceAdapter>();

export function registerAdapter(a: MarketplaceAdapter) {
  adapters.set(a.provider, a);
}

export const getAdapter = (provider: string) => adapters.get(provider);
export const hasAdapter = (provider: string) => adapters.has(provider);

/** Provedores com integração real de pedidos/anúncios */
export const MARKETPLACE_PROVIDERS = ['MERCADO_LIVRE', 'SHOPEE', 'NUVEMSHOP', 'SHOPIFY', 'WOOCOMMERCE'];
