/**
 * Registro de recursos com CRUD genérico (/api/r/[resource]).
 * Cada recurso define o model do Prisma, escopo (organização ou empresa),
 * módulo de permissão, campos de busca e transformações de entrada.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Ctx } from './context';
import type { ModuleKey } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { fail } from './errors';
import { emit } from './events';
import { onlyDigits } from '@/lib/utils';
import { isValidCNPJ, isValidCPF } from '@/lib/br';

export type ResourceDef = {
  model: string;
  scope: 'org' | 'company' | 'none';
  module: ModuleKey;
  search?: string[];
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  include?: Record<string, unknown>;
  /** filtros adicionais via querystring (?type=CLIENTE) */
  filters?: Record<string, (v: string) => Record<string, unknown>>;
  /** campos permitidos na escrita (whitelist). */
  fields: string[];
  numbers?: string[];
  dates?: string[];
  booleans?: string[];
  beforeSave?: (data: Record<string, any>, ctx: Ctx, id?: string) => Promise<Record<string, any>> | Record<string, any>;
  afterCreate?: (row: any, ctx: Ctx) => Promise<void>;
  canDelete?: (id: string, ctx: Ctx) => Promise<void>;
  /** sobrescreve a busca da lista */
  listWhere?: (ctx: Ctx) => Record<string, unknown>;
};

const contactFields = ['code', 'types', 'personType', 'name', 'tradeName', 'document', 'ie', 'ieIndicator', 'email', 'phone', 'mobile', 'birthDate', 'creditLimit', 'priceListId', 'sellerId', 'notes', 'active', 'zip', 'street', 'number', 'complement', 'district', 'city', 'uf', 'addresses', 'persons'];

export const RESOURCES: Record<string, ResourceDef> = {
  contacts: {
    model: 'contact', scope: 'org', module: 'cadastros', search: ['name', 'tradeName', 'document', 'email', 'city'], orderBy: { name: 'asc' },
    include: { addresses: true, persons: true, priceList: { select: { id: true, name: true } }, seller: { select: { id: true, name: true } } },
    filters: { type: (v) => ({ types: { has: v } }), personType: (v) => ({ personType: v }), active: (v) => ({ active: v === 'true' }) },
    fields: contactFields, numbers: ['creditLimit', 'ieIndicator'], dates: ['birthDate'], booleans: ['active'],
    beforeSave: (d, _ctx, id) => {
      if (d.document) {
        const doc = onlyDigits(d.document);
        if (doc.length === 11 && !isValidCPF(doc)) fail(400, 'CPF inválido');
        if (doc.length === 14 && !isValidCNPJ(doc)) fail(400, 'CNPJ inválido');
        d.document = doc;
      }
      if (d.zip) d.zip = onlyDigits(d.zip);
      if (!d.types?.length && !id) d.types = ['CLIENTE'];
      // Endereços e pessoas de contato como escrita aninhada (substitui a lista)
      if (Array.isArray(d.addresses)) {
        const list = d.addresses.map(({ id: _i, contactId: _c, ...a }: Record<string, unknown>) => a);
        d.addresses = id ? { deleteMany: {}, create: list } : { create: list };
      }
      if (Array.isArray(d.persons)) {
        const list = d.persons.filter((p: { name?: string }) => p.name).map(({ id: _i, contactId: _c, ...a }: Record<string, unknown>) => a);
        d.persons = id ? { deleteMany: {}, create: list } : { create: list };
      }
      return d;
    },
    afterCreate: async (row, ctx) => {
      if (row.types?.includes('CLIENTE')) await emit('contact.created', { companyId: ctx.companyId, orgId: ctx.orgId, contactId: row.id, email: row.email, userName: ctx.userName });
    },
  },
  sellers: {
    model: 'seller', scope: 'org', module: 'cadastros', search: ['name', 'email'], orderBy: { name: 'asc' },
    filters: { kind: (v) => ({ kind: v }) },
    fields: ['name', 'kind', 'email', 'phone', 'document', 'commissionRate', 'commissionBase', 'userId', 'active'], numbers: ['commissionRate'], booleans: ['active'],
  },
  categories: { model: 'category', scope: 'org', module: 'cadastros', search: ['name'], orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } }, fields: ['name', 'parentId'] },
  services: {
    model: 'service', scope: 'org', module: 'cadastros', search: ['name', 'code'], orderBy: { name: 'asc' },
    fields: ['code', 'name', 'price', 'unit', 'serviceCode', 'cnae', 'issRate', 'description', 'active'], numbers: ['price', 'issRate'], booleans: ['active'],
  },
  'price-lists': {
    model: 'priceList', scope: 'org', module: 'cadastros', search: ['name'], orderBy: { name: 'asc' },
    include: { items: { include: { product: { select: { id: true, sku: true, name: true, price: true } } } }, _count: { select: { contacts: true } } },
    fields: ['name', 'type', 'adjustPercent', 'minQuantity', 'validFrom', 'validUntil', 'active', 'items'], numbers: ['adjustPercent', 'minQuantity'], dates: ['validFrom', 'validUntil'], booleans: ['active'],
    beforeSave: (d, _c, id) => {
      if (Array.isArray(d.items)) {
        const list = d.items.filter((i: { productId?: string }) => i.productId).map((i: { productId: string; price: number }) => ({ productId: i.productId, price: Number(i.price) || 0 }));
        d.items = id ? { deleteMany: {}, create: list } : { create: list };
      }
      return d;
    },
    afterCreate: async (_row, ctx) => {
      await emit('product.price_changed', { companyId: ctx.companyId, orgId: ctx.orgId });
    },
  },
  warehouses: {
    model: 'warehouse', scope: 'company', module: 'estoque', search: ['name', 'code'], orderBy: { name: 'asc' },
    fields: ['name', 'code', 'isDefault', 'available', 'active'], booleans: ['isDefault', 'available', 'active'],
    beforeSave: async (d, ctx) => {
      if (d.isDefault) await prisma.warehouse.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
      return d;
    },
  },
  'bank-accounts': {
    model: 'bankAccount', scope: 'company', module: 'financeiro', search: ['name', 'bankName'], orderBy: { name: 'asc' },
    fields: ['name', 'type', 'bankCode', 'bankName', 'agency', 'accountNumber', 'pixKey', 'initialBalance', 'isDefault', 'active'], numbers: ['initialBalance'], booleans: ['isDefault', 'active'],
    beforeSave: async (d, ctx) => {
      if (d.isDefault) await prisma.bankAccount.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
      return d;
    },
  },
  'chart-accounts': {
    model: 'chartAccount', scope: 'company', module: 'financeiro', search: ['name', 'code'], orderBy: { code: 'asc' },
    filters: { type: (v) => ({ type: v }) },
    fields: ['code', 'name', 'type', 'dreGroup', 'parentId', 'active'], booleans: ['active'],
  },
  'cost-centers': { model: 'costCenter', scope: 'company', module: 'financeiro', search: ['name', 'code'], orderBy: { name: 'asc' }, fields: ['code', 'name', 'active'], booleans: ['active'] },
  natures: {
    model: 'operationNature', scope: 'company', module: 'fiscal', search: ['name', 'cfopIntra'], orderBy: { name: 'asc' },
    fields: ['name', 'kind', 'direction', 'cfopIntra', 'cfopInter', 'icmsCst', 'csosn', 'icmsRateIntra', 'icmsRateInter', 'ipiCst', 'pisCst', 'cofinsCst', 'pisRate', 'cofinsRate', 'issRate', 'finalidade', 'movesStock', 'generatesFinancial', 'isDefault', 'notes'],
    numbers: ['icmsRateIntra', 'icmsRateInter', 'pisRate', 'cofinsRate', 'issRate', 'finalidade'], booleans: ['movesStock', 'generatesFinancial', 'isDefault'],
  },
  'custom-types': {
    model: 'customEntityType', scope: 'org', module: 'cadastros', search: ['name'], orderBy: { name: 'asc' }, include: { _count: { select: { records: true } } },
    fields: ['name', 'slug', 'icon', 'fields'],
    beforeSave: (d) => {
      if (d.name && !d.slug) d.slug = d.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return d;
    },
  },
  'custom-records': {
    model: 'customEntityRecord', scope: 'none', module: 'cadastros', orderBy: { createdAt: 'desc' },
    filters: { typeId: (v) => ({ typeId: v }) },
    listWhere: (ctx) => ({ type: { organizationId: ctx.orgId } }),
    fields: ['typeId', 'data'],
    beforeSave: async (d, ctx) => {
      if (d.typeId) {
        const t = await prisma.customEntityType.findFirst({ where: { id: d.typeId, organizationId: ctx.orgId } });
        if (!t) fail(400, 'Tipo de cadastro inválido');
      }
      return d;
    },
  },
  webhooks: {
    model: 'webhook', scope: 'company', module: 'integracoes', search: ['url'], orderBy: { createdAt: 'desc' }, include: { _count: { select: { deliveries: true } } },
    fields: ['url', 'events', 'active'], booleans: ['active'],
    beforeSave: (d, _c, id) => {
      if (!id) d.secret = crypto.randomBytes(16).toString('hex');
      return d;
    },
  },
  'pos-terminals': {
    model: 'posTerminal', scope: 'company', module: 'financeiro', search: ['name', 'serial'], orderBy: { name: 'asc' },
    fields: ['name', 'serial', 'acquirer', 'bankAccountId', 'debitFee', 'creditFee', 'pixFee', 'active'], numbers: ['debitFee', 'creditFee', 'pixFee'], booleans: ['active'],
  },
  roles: {
    model: 'role', scope: 'org', module: 'configuracoes', search: ['name'], orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } },
    fields: ['name', 'description', 'isAdmin', 'permissions'], booleans: ['isAdmin'],
    canDelete: async (id) => {
      if (await prisma.user.count({ where: { roleId: id } })) fail(409, 'Perfil possui usuários vinculados');
    },
  },
  users: {
    model: 'user', scope: 'org', module: 'configuracoes', search: ['name', 'email'], orderBy: { name: 'asc' },
    include: { role: { select: { id: true, name: true } }, companies: { select: { companyId: true } } },
    fields: ['name', 'email', 'roleId', 'active', 'password', 'companyIds'], booleans: ['active'],
    beforeSave: async (d, ctx, id) => {
      if (d.email) d.email = String(d.email).toLowerCase().trim();
      if (d.roleId && !(await prisma.role.findFirst({ where: { id: d.roleId, organizationId: ctx.orgId } }))) fail(400, 'Perfil inválido');
      if (d.password) {
        if (String(d.password).length < 6) fail(400, 'A senha deve ter ao menos 6 caracteres');
        d.passwordHash = await bcrypt.hash(String(d.password), 10);
      } else if (!id) fail(400, 'Informe a senha');
      delete d.password;
      if (Array.isArray(d.companyIds)) {
        const valid = d.companyIds.filter((c: string) => ctx.companyIds.includes(c));
        d.companies = id ? { deleteMany: {}, create: valid.map((companyId: string) => ({ companyId })) } : { create: valid.map((companyId: string) => ({ companyId })) };
      }
      delete d.companyIds;
      if (id === ctx.userId && d.active === false) fail(400, 'Você não pode desativar o próprio usuário');
      return d;
    },
    canDelete: async (id, ctx) => {
      if (id === ctx.userId) fail(400, 'Você não pode excluir o próprio usuário');
    },
  },
  companies: {
    model: 'company', scope: 'none', module: 'configuracoes', search: ['name', 'tradeName', 'cnpj'], orderBy: { createdAt: 'asc' },
    listWhere: (ctx) => ({ organizationId: ctx.orgId }),
    fields: ['name', 'tradeName', 'cnpj', 'ie', 'im', 'taxRegime', 'crt', 'email', 'phone', 'zip', 'street', 'number', 'district', 'city', 'cityCode', 'uf', 'logoColor', 'nfeSeries', 'nfceSeries', 'cscId', 'cscToken'],
    numbers: ['crt', 'nfeSeries', 'nfceSeries'],
    beforeSave: (d, ctx, id) => {
      if (d.cnpj) {
        d.cnpj = onlyDigits(d.cnpj);
        if (!isValidCNPJ(d.cnpj)) fail(400, 'CNPJ inválido');
      }
      if (d.taxRegime) d.crt = d.taxRegime === 'SIMPLES' ? 1 : 3;
      if (!id) d.organizationId = ctx.orgId;
      return d;
    },
    afterCreate: async (row) => {
      // Estrutura mínima para a nova empresa operar
      const { bootstrapCompany } = await import('./services/bootstrap');
      await bootstrapCompany(row.id);
    },
  },
};

/** Normaliza o corpo recebido de acordo com a definição (whitelist + tipos) */
export function sanitize(def: ResourceDef, body: Record<string, unknown>) {
  const out: Record<string, any> = {};
  for (const f of def.fields) {
    if (!(f in body)) continue;
    let v: any = body[f];
    if (def.numbers?.includes(f)) v = v === '' || v == null ? 0 : Number(String(v).replace(',', '.'));
    else if (def.dates?.includes(f)) v = v ? new Date(v as string) : null;
    else if (def.booleans?.includes(f)) v = v === true || v === 'true' || v === 'on' || v === 1;
    else if (v === '') v = null;
    out[f] = v;
  }
  return out;
}
