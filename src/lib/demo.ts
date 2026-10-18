/**
 * Modo demonstração: mostra os botões de acesso rápido e aceita as senhas padrão.
 * Em produção fica DESLIGADO, a menos que DEMO_MODE=true (servidor público de demonstração).
 */
export const isDemoMode = () => process.env.DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false');

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
