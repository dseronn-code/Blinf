// Módulos do sistema usados para controle de acesso por perfil
export const MODULES = [
  { key: 'dashboard', label: 'Início / Dashboard' },
  { key: 'cadastros', label: 'Cadastros' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'compras', label: 'Compras' },
  { key: 'vendas', label: 'Vendas' },
  { key: 'pdv', label: 'PDV / Frente de caixa' },
  { key: 'fiscal', label: 'Notas fiscais' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'producao', label: 'Produção' },
  { key: 'servicos', label: 'Ordens de serviço' },
  { key: 'logistica', label: 'Logística / Envios' },
  { key: 'integracoes', label: 'Integrações e API' },
  { key: 'loja', label: 'Loja virtual' },
  { key: 'relatorios', label: 'Relatórios e IA' },
  { key: 'automacoes', label: 'Automações' },
  { key: 'configuracoes', label: 'Configurações, empresas e usuários' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export type AccessLevel = 'none' | 'view' | 'edit';
export type Permissions = Partial<Record<ModuleKey, AccessLevel>>;

const rank: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export function can(perms: Permissions | undefined, isAdmin: boolean | undefined, mod: ModuleKey, level: AccessLevel = 'view') {
  if (isAdmin) return true;
  const have = (perms?.[mod] as AccessLevel) || 'none';
  return rank[have] >= rank[level];
}

/** Perfis padrão criados para toda nova conta */
export const DEFAULT_ROLES: { name: string; description: string; isAdmin?: boolean; permissions: Permissions }[] = [
  { name: 'Administrador', description: 'Acesso total ao sistema', isAdmin: true, permissions: {} },
  {
    name: 'Vendedor',
    description: 'Vendas, propostas, PDV e consulta de estoque',
    permissions: { dashboard: 'view', cadastros: 'edit', estoque: 'view', vendas: 'edit', pdv: 'edit', fiscal: 'view', logistica: 'view', relatorios: 'view' },
  },
  {
    name: 'Financeiro',
    description: 'Contas, fluxo de caixa, conciliação e relatórios',
    permissions: { dashboard: 'view', cadastros: 'view', vendas: 'view', compras: 'view', fiscal: 'edit', financeiro: 'edit', relatorios: 'edit' },
  },
  {
    name: 'Estoquista',
    description: 'Estoque, compras, recebimento, produção e expedição',
    permissions: { dashboard: 'view', cadastros: 'view', estoque: 'edit', compras: 'edit', producao: 'edit', logistica: 'edit', vendas: 'view' },
  },
];
