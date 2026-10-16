/**
 * Código IBGE do município (cMun) — exigido no endereço do destinatário, no
 * MDF-e, na DPS da NFS-e e na GNRE. Usa uma tabela local (capitais e grandes
 * cidades) e, quando permitido, a API pública de localidades do IBGE.
 */
import { httpRequest } from '@/server/integrations/http';
import { UF_CODES } from '@/lib/br';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const LOCAL: Record<string, string> = {
  'AC|RIO BRANCO': '1200401', 'AL|MACEIO': '2704302', 'AP|MACAPA': '1600303', 'AM|MANAUS': '1302603', 'BA|SALVADOR': '2927408', 'BA|FEIRA DE SANTANA': '2910800',
  'CE|FORTALEZA': '2304400', 'DF|BRASILIA': '5300108', 'ES|VITORIA': '3205309', 'ES|VILA VELHA': '3205200', 'GO|GOIANIA': '5208707', 'GO|ANAPOLIS': '5201108',
  'MA|SAO LUIS': '2111300', 'MT|CUIABA': '5103403', 'MS|CAMPO GRANDE': '5002704', 'MG|BELO HORIZONTE': '3106200', 'MG|UBERLANDIA': '3170206', 'MG|CONTAGEM': '3118601',
  'MG|JUIZ DE FORA': '3136702', 'PA|BELEM': '1501402', 'PB|JOAO PESSOA': '2507507', 'PR|CURITIBA': '4106902', 'PR|LONDRINA': '4113700', 'PR|MARINGA': '4115200',
  'PE|RECIFE': '2611606', 'PI|TERESINA': '2211001', 'RJ|RIO DE JANEIRO': '3304557', 'RJ|NITEROI': '3303302', 'RJ|DUQUE DE CAXIAS': '3301702', 'RN|NATAL': '2408102',
  'RS|PORTO ALEGRE': '4314902', 'RS|CAXIAS DO SUL': '4305108', 'RO|PORTO VELHO': '1100205', 'RR|BOA VISTA': '1400100', 'SC|FLORIANOPOLIS': '4205407',
  'SC|JOINVILLE': '4209102', 'SC|BLUMENAU': '4202404', 'SP|SAO PAULO': '3550308', 'SP|CAMPINAS': '3509502', 'SP|GUARULHOS': '3518800', 'SP|SANTOS': '3548500',
  'SP|SAO BERNARDO DO CAMPO': '3548708', 'SP|SANTO ANDRE': '3547809', 'SP|OSASCO': '3534401', 'SP|RIBEIRAO PRETO': '3543402', 'SP|SOROCABA': '3552205',
  'SP|SAO JOSE DOS CAMPOS': '3549904', 'SE|ARACAJU': '2800308', 'TO|PALMAS': '1721000',
};

const cache = new Map<string, Record<string, string>>();

/** Código do município pela tabela local (sem rede) */
export function localCityCode(uf: string | null | undefined, city: string | null | undefined) {
  if (!uf || !city) return null;
  return LOCAL[`${uf}|${norm(city)}`] || null;
}

/** Resolve o código IBGE (tabela local → API do IBGE). `online=false` não usa a rede. */
export async function resolveCityCode(uf: string | null | undefined, city: string | null | undefined, opts: { companyId?: string; online?: boolean; fallback?: string | null } = {}) {
  if (!uf || !city) return opts.fallback || null;
  const local = localCityCode(uf, city);
  if (local) return local;
  if (opts.online) {
    try {
      let map = cache.get(uf);
      if (!map) {
        const res = await httpRequest<{ id: number; nome: string }[]>({ provider: 'IBGE', companyId: opts.companyId, url: `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF_CODES[uf] || uf}/municipios`, timeoutMs: 15000 });
        if (res.ok && Array.isArray(res.data)) {
          map = Object.fromEntries(res.data.map((m) => [norm(m.nome), String(m.id)]));
          cache.set(uf, map);
        }
      }
      const code = map?.[norm(city)];
      if (code) return code;
    } catch {
      /* segue para o fallback */
    }
  }
  return opts.fallback || null;
}
