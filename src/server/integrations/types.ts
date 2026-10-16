import type { InboundEvent } from '@prisma/client';

export type FieldDef = {
  key: string;
  label: string;
  /** segredo: guardado criptografado e nunca devolvido à interface */
  secret?: boolean;
  required?: boolean;
  help?: string;
  type?: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'switch';
  options?: { value: string; label: string }[];
  placeholder?: string;
};

export type AccountCtx = {
  id: string;
  companyId: string;
  provider: string;
  environment: 'SANDBOX' | 'PRODUCAO';
  status: string;
  secrets: Record<string, string>;
  settings: Record<string, any>;
  externalAccountId: string | null;
  accountName: string | null;
  tokenExpiresAt: Date | null;
};

export type TokenResult = { accessToken: string; refreshToken?: string; expiresIn?: number; externalAccountId?: string; accountName?: string; extra?: Record<string, string> };

export type TestResult = { accountName?: string; externalAccountId?: string; message?: string };

export type ProviderCategory = 'PAGAMENTO' | 'MARKETPLACE' | 'ECOMMERCE' | 'LOGISTICA' | 'MENSAGENS' | 'FISCAL';

export type ProviderDef = {
  key: string;
  name: string;
  category: ProviderCategory;
  description: string;
  color?: string;
  docsUrl?: string;
  /** API_KEY: o cliente cola a chave | OAUTH: botão "Conectar" | SMTP | CERTIFICADO */
  auth: 'API_KEY' | 'OAUTH' | 'SMTP' | 'CERTIFICADO';
  /** suporta ambiente de testes (sandbox/homologação) */
  sandbox?: boolean;
  fields: FieldDef[];
  /** o que a integração faz quando conectada (exibido na tela) */
  capabilities: string[];
  oauth?: {
    /** credenciais do aplicativo da plataforma (variáveis de ambiente) — como o Bling, que tem um app único por marketplace */
    appConfigured: () => boolean;
    authorizeUrl: (acc: AccountCtx, state: string, redirectUri: string) => string | Promise<string>;
    exchange: (acc: AccountCtx, params: URLSearchParams, redirectUri: string) => Promise<TokenResult>;
    refresh?: (acc: AccountCtx) => Promise<TokenResult>;
  };
  /** valida as credenciais chamando a API (ex.: GET /me) */
  test: (acc: AccountCtx) => Promise<TestResult>;
  /** sincronização periódica (pedidos novos, status de etiquetas/cobranças) quando não há webhook */
  poll?: { everyMinutes: number; run: (acc: AccountCtx) => Promise<string | void> };
  webhook?: {
    /** confere assinatura/token; devolve false para rejeitar (401) */
    verify?: (acc: AccountCtx | null, req: { headers: Headers; raw: string; query: URLSearchParams }) => boolean | Promise<boolean>;
    /** quando a URL não identifica a conta (ex.: Mercado Livre manda user_id), localiza pela notificação */
    findAccount?: (body: any) => Promise<AccountCtx | null>;
    describe?: (body: any) => { topic?: string; externalId?: string };
    process: (event: InboundEvent, acc: AccountCtx) => Promise<string | void>;
  };
};
