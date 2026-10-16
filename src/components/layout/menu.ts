import {
  LayoutDashboard, Users, Package, Warehouse, ShoppingCart, ShoppingBag, Receipt, Wallet, Factory, Wrench, Truck, Plug, Store, BarChart3, Bot, Zap, Settings, Monitor,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/permissions';

export type MenuItem = { label: string; href: string };
export type MenuGroup = { label: string; icon: React.ComponentType<{ className?: string }>; module: ModuleKey; href?: string; items?: MenuItem[] };

export const MENU: MenuGroup[] = [
  { label: 'Início', icon: LayoutDashboard, module: 'dashboard', href: '/' },
  {
    label: 'Cadastros', icon: Users, module: 'cadastros', items: [
      { label: 'Clientes e fornecedores', href: '/cadastros/contatos' },
      { label: 'Produtos', href: '/cadastros/produtos' },
      { label: 'Serviços', href: '/cadastros/servicos' },
      { label: 'Vendedores e funcionários', href: '/cadastros/vendedores' },
      { label: 'Listas de preço', href: '/cadastros/listas-preco' },
      { label: 'Categorias', href: '/cadastros/categorias' },
      { label: 'Cadastros personalizados', href: '/cadastros/personalizados' },
      { label: 'Importar planilha', href: '/cadastros/importacao' },
    ],
  },
  {
    label: 'Estoque', icon: Warehouse, module: 'estoque', items: [
      { label: 'Controle de estoque', href: '/estoque' },
      { label: 'Movimentações', href: '/estoque/movimentacoes' },
      { label: 'Lotes e validades', href: '/estoque/lotes' },
      { label: 'Curva ABC', href: '/estoque/curva-abc' },
      { label: 'Inventário (contagem)', href: '/estoque/inventario' },
      { label: 'Transferência entre empresas', href: '/estoque/transferencias' },
      { label: 'Etiquetas', href: '/estoque/etiquetas' },
      { label: 'Depósitos', href: '/estoque/depositos' },
    ],
  },
  {
    label: 'Compras', icon: ShoppingBag, module: 'compras', items: [
      { label: 'Pedidos de compra', href: '/compras' },
      { label: 'Check-in de recebimento', href: '/compras/checkin' },
      { label: 'Importar XML de NF-e', href: '/compras/xml' },
    ],
  },
  {
    label: 'Vendas', icon: ShoppingCart, module: 'vendas', items: [
      { label: 'Pedidos de venda', href: '/vendas' },
      { label: 'Propostas comerciais', href: '/vendas/propostas' },
      { label: 'Vendas multicanal', href: '/vendas/multicanal' },
      { label: 'Gestão de anúncios', href: '/vendas/anuncios' },
      { label: 'Devoluções e trocas', href: '/vendas/devolucoes' },
      { label: 'Comissões', href: '/vendas/comissoes' },
    ],
  },
  { label: 'PDV / Frente de caixa', icon: Monitor, module: 'pdv', href: '/pdv' },
  {
    label: 'Notas fiscais', icon: Receipt, module: 'fiscal', items: [
      { label: 'NF-e (modelo 55)', href: '/fiscal/notas?model=NFE' },
      { label: 'NFC-e (modelo 65)', href: '/fiscal/notas?model=NFCE' },
      { label: 'NFS-e', href: '/fiscal/notas?model=NFSE' },
      { label: 'Emitir nota avulsa', href: '/fiscal/nova' },
      { label: 'Manifestação do destinatário', href: '/fiscal/manifestacao' },
      { label: 'Inutilização de numeração', href: '/fiscal/inutilizacao' },
      { label: 'Arquivos do contador (SPED)', href: '/fiscal/contador' },
      { label: 'Naturezas de operação', href: '/fiscal/naturezas' },
      { label: 'Certificado digital', href: '/fiscal/certificado' },
    ],
  },
  {
    label: 'Finanças', icon: Wallet, module: 'financeiro', items: [
      { label: 'Contas a receber', href: '/financeiro/receber' },
      { label: 'Contas a pagar', href: '/financeiro/pagar' },
      { label: 'Fluxo de caixa', href: '/financeiro/fluxo' },
      { label: 'Conta Digital PJ', href: '/financeiro/conta-digital' },
      { label: 'Conciliação bancária', href: '/financeiro/conciliacao' },
      { label: 'Boletos, Pix e links', href: '/financeiro/cobrancas' },
      { label: 'Remessa e retorno CNAB', href: '/financeiro/cnab' },
      { label: 'Maquininhas (POS)', href: '/financeiro/pos' },
      { label: 'Agenda de recebíveis', href: '/financeiro/recebiveis' },
      { label: 'DRE gerencial', href: '/financeiro/dre' },
      { label: 'Orçamento', href: '/financeiro/orcamento' },
      { label: 'Inadimplência', href: '/financeiro/inadimplencia' },
      { label: 'Contas bancárias', href: '/financeiro/contas' },
      { label: 'Plano de contas', href: '/financeiro/plano-contas' },
      { label: 'Centros de custo', href: '/financeiro/centros-custo' },
    ],
  },
  {
    label: 'Produção', icon: Factory, module: 'producao', items: [
      { label: 'Ordens de produção', href: '/producao' },
      { label: 'Calendário', href: '/producao/calendario' },
    ],
  },
  { label: 'Ordens de serviço', icon: Wrench, module: 'servicos', href: '/servicos' },
  {
    label: 'Logística', icon: Truck, module: 'logistica', items: [
      { label: 'Separação e embalagem', href: '/logistica/separacao' },
      { label: 'Envios e rastreio', href: '/logistica/envios' },
      { label: 'Cotação de frete', href: '/logistica/cotacao' },
    ],
  },
  {
    label: 'Integrações', icon: Plug, module: 'integracoes', items: [
      { label: 'Central de integrações', href: '/integracoes' },
      { label: 'Logs de sincronização', href: '/integracoes/logs' },
      { label: 'API e webhooks', href: '/integracoes/api' },
    ],
  },
  { label: 'Loja virtual', icon: Store, module: 'loja', href: '/loja-virtual' },
  { label: 'Relatórios', icon: BarChart3, module: 'relatorios', href: '/relatorios' },
  { label: 'Assistente IA', icon: Bot, module: 'relatorios', href: '/assistente' },
  { label: 'Automações', icon: Zap, module: 'automacoes', href: '/automacoes' },
  {
    label: 'Configurações', icon: Settings, module: 'configuracoes', items: [
      { label: 'Empresas (multi-CNPJ)', href: '/configuracoes/empresas' },
      { label: 'Usuários', href: '/configuracoes/usuarios' },
      { label: 'Perfis e permissões', href: '/configuracoes/perfis' },
      { label: 'Preferências', href: '/configuracoes/preferencias' },
      { label: 'Segurança (2FA)', href: '/configuracoes/seguranca' },
      { label: 'Sistema e auditoria', href: '/configuracoes/sistema' },
    ],
  },
];
void Package;
