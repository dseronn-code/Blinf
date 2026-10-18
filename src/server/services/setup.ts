/**
 * Primeiro acesso e recomeço: cria a organização com a empresa REAL do cliente,
 * os perfis padrão e o usuário administrador. `resetEverything` apaga todos os
 * dados (inclusive os de demonstração) antes de criar.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { DEFAULT_ROLES } from '@/lib/permissions';
import { isValidCNPJ } from '@/lib/br';
import { onlyDigits } from '@/lib/utils';
import { WEAK_PASSWORDS } from '@/lib/demo';
import { fail } from '../errors';
import { bootstrapCompany } from './bootstrap';

export type SetupInput = {
  company: { name: string; tradeName?: string; cnpj: string; ie?: string; im?: string; taxRegime: 'SIMPLES' | 'PRESUMIDO' | 'REAL'; email?: string; phone?: string; zip?: string; street?: string; number?: string; district?: string; city?: string; cityCode?: string; uf: string };
  admin: { name: string; email: string; password: string };
};

export function validateSetup(input: SetupInput) {
  const c = input?.company;
  const a = input?.admin;
  if (!c?.name?.trim()) fail(400, 'Informe a razão social');
  const cnpj = onlyDigits(c.cnpj);
  if (!isValidCNPJ(cnpj)) fail(400, 'CNPJ inválido');
  if (!/^[A-Z]{2}$/.test(String(c.uf || '').toUpperCase())) fail(400, 'Informe a UF');
  if (!['SIMPLES', 'PRESUMIDO', 'REAL'].includes(c.taxRegime)) fail(400, 'Informe o regime tributário');
  if (!a?.name?.trim()) fail(400, 'Informe o nome do administrador');
  if (!/^\S+@\S+\.\S+$/.test(String(a.email || ''))) fail(400, 'E-mail do administrador inválido');
  if (!a.password || a.password.length < 8 || WEAK_PASSWORDS.includes(a.password)) fail(400, 'Use uma senha com pelo menos 8 caracteres (e que não seja uma senha comum)');
}

async function create(input: SetupInput) {
  const c = input.company;
  const org = await prisma.organization.create({ data: { name: c.tradeName || c.name, stockMode: 'SEPARADO' } });
  let adminRole = '';
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.create({ data: { organizationId: org.id, name: r.name, description: r.description, isAdmin: !!r.isAdmin, permissions: r.permissions } });
    if (r.isAdmin) adminRole = role.id;
  }
  const company = await prisma.company.create({
    data: {
      organizationId: org.id, name: c.name.trim(), tradeName: c.tradeName?.trim() || null, cnpj: onlyDigits(c.cnpj), ie: c.ie?.trim() || null, im: c.im?.trim() || null,
      taxRegime: c.taxRegime, crt: c.taxRegime === 'SIMPLES' ? 1 : 3, email: c.email || null, phone: c.phone || null, zip: onlyDigits(c.zip) || null, street: c.street || null, number: c.number || null,
      district: c.district || null, city: c.city || null, cityCode: onlyDigits(c.cityCode) || null, uf: c.uf.toUpperCase(),
      // produção da SEFAZ só depois que o cliente instalar o certificado e testar em homologação
      nfeEnvironment: 2, fiscalProvider: 'SIMULADO', sefazMode: 'SIMULADO',
    },
  });
  await bootstrapCompany(company.id);
  const user = await prisma.user.create({
    data: { organizationId: org.id, roleId: adminRole, name: input.admin.name.trim(), email: input.admin.email.toLowerCase().trim(), passwordHash: await bcrypt.hash(input.admin.password, 10), companies: { create: [{ companyId: company.id }] } },
  });
  return { organizationId: org.id, companyId: company.id, userId: user.id, email: user.email };
}

/** Primeiro acesso: só funciona enquanto não houver empresa real (a organização de demonstração não conta) */
export async function firstSetup(input: SetupInput) {
  validateSetup(input);
  if (await prisma.organization.count({ where: { demo: false } })) fail(409, 'O GestãoPro já foi configurado. Entre com o seu usuário.');
  return create(input);
}

export async function setupNeeded() {
  return (await prisma.organization.count({ where: { demo: false } })) === 0;
}

/** Exportação completa (backup lógico em JSON) de todas as tabelas */
export async function exportAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t.tablename] = await prisma.$queryRawUnsafe(`SELECT * FROM "${t.tablename}"`);
  return { app: 'gestaopro', version: 1, exportedAt: new Date().toISOString(), tables: out };
}
