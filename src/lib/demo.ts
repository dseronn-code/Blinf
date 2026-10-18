/**
 * Modo demonstração: mostra os botões de acesso rápido e aceita as senhas padrão.
 * Em produção fica DESLIGADO, a menos que DEMO_MODE=true (servidor público de demonstração).
 */
import { AsyncLocalStorage } from 'async_hooks';

/** Servidor inteiro em demonstração (DEMO_MODE=true ou fora de produção) */
export const isDemoServer = () => process.env.DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false');

/**
 * Demonstração por organização: a requisição de um usuário da organização de
 * demonstração (ex.: login "teste123") roda com demo=true; as demais, produção.
 */
const demoContext = new AsyncLocalStorage<{ demo: boolean }>();

/** Executa `fn` no contexto da organização (demonstração ou produção) */
export const runWithDemo = <T>(demo: boolean, fn: () => T) => demoContext.run({ demo: demo || isDemoServer() }, fn);
/** Marca o restante da execução atual (rotas públicas: loja, link de pagamento) */
export const enterDemo = (demo: boolean) => demoContext.enterWith({ demo: demo || isDemoServer() });

export const isDemoMode = () => demoContext.getStore()?.demo ?? isDemoServer();

/** Senhas conhecidas (dados de demonstração) que precisam ser trocadas fora do modo demo */
export const WEAK_PASSWORDS = ['admin123', 'demo123', '123456', '12345678', 'senha123'];

/**
 * Bloqueia um recurso simulado em produção, explicando o que configurar.
 * Ex.: requireRealOrDemo('Emissão de NF-e', 'Instale o certificado A1 em Notas fiscais → Certificado e escolha "SEFAZ direta".')
 */
export class RealIntegrationRequired extends Error {
  status = 400;
  constructor(public feature: string, public howTo: string) {
    super(`${feature} precisa de configuração: ${howTo}`);
  }
}
export function requireRealOrDemo(feature: string, howTo: string) {
  if (!isDemoMode()) throw new RealIntegrationRequired(feature, howTo);
}
