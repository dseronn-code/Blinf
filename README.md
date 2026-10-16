# GestãoPro — ERP online para PMEs brasileiras

Clone funcional, no estilo do Bling, de um sistema de gestão completo: cadastros, estoque, compras, vendas multicanal, PDV, notas fiscais (NF-e/NFC-e/NFS-e), financeiro com conta digital, produção, ordens de serviço, logística, integrações com marketplaces, loja virtual, relatórios, assistente de IA e automações. Tudo integrado: os dados fluem entre os módulos.

> ⚠️ **Ambiente de demonstração.** As integrações externas (SEFAZ, prefeituras, bancos, Pix, adquirentes, Correios/Melhor Envio, marketplaces, WhatsApp) são **simuladas** de forma realista. Os algoritmos (chave de acesso NF-e com DV, XML 4.00 **assinado com certificado A1 real (XMLDSig)**, CNAB 400, linha digitável FEBRABAN, BR Code Pix com CRC16, rastreio UPU, TOTP) seguem os padrões reais, mas nenhum documento tem valor fiscal e nenhuma chamada é feita a serviços oficiais. As telas que simulam algo mostram um aviso 🧪.
>
> **O que é real (funciona fora do demo):** e-mail via SMTP, assinatura digital do XML com o seu `.pfx`, arquivos CNAB/SPED/Sintegra/OFX, webhooks HTTP (com `WEBHOOKS_SIMULATE_ONLY=false`), API REST, 2FA, backups. **O que depende de credenciais/contratos externos:** autorização na SEFAZ/prefeituras, APIs bancárias e de adquirentes, marketplaces, Correios/Melhor Envio e WhatsApp Business.

---

## 🚀 Subindo com Docker (recomendado)

```bash
docker compose up --build
```

Acesse **http://localhost:3000**. No primeiro start o container aplica as migrações e carrega os dados de demonstração (~2 minutos; os pedidos do histórico passam pelos fluxos reais do sistema).

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@gestaopro.com.br` | `admin123` |
| Vendedor | `vendedor@gestaopro.com.br` | `demo123` |
| Financeiro | `financeiro@gestaopro.com.br` | `demo123` |
| Estoquista | `estoque@gestaopro.com.br` | `demo123` |

A tela de login tem botões de acesso rápido para cada perfil.

Variáveis opcionais (crie um `.env` ao lado do `docker-compose.yml`):

```env
ANTHROPIC_API_KEY=sk-ant-...      # assistente de IA com Claude (sem chave usa o motor local)
NEXTAUTH_SECRET=um-segredo-forte
NEXTAUTH_URL=https://erp.suaempresa.com.br
WEBHOOKS_SIMULATE_ONLY=true       # false = webhooks fazem POST real para as URLs cadastradas
SMTP_HOST=smtp.seuprovedor.com    # e-mails reais (senão ficam na caixa de saída como SIMULADO)
SMTP_USER=... SMTP_PASS=... SMTP_FROM="Loja <nao-responda@loja.com.br>"
ACCOUNTANT_EMAIL=contador@escritorio.com.br   # recebe XML/DANFE das notas autorizadas
APP_HOSTS=erp.suaempresa.com.br   # outros hosts viram domínio próprio de loja virtual
```

O `docker compose` também sobe um serviço de **backup diário** (`pg_dump` compactado em `./backups`, retenção de 14 dias) e o app expõe `GET /api/health` (usado no healthcheck).
Restaurar um backup: `gunzip -c backups/gestaopro-AAAAMMDD-HHMM.sql.gz | docker compose exec -T db psql -U gestao gestaopro`.

Para recriar os dados de demonstração: `docker compose exec app sh -c "SEED_FORCE=1 npm run db:seed"`.

## 💻 Rodando localmente (sem Docker)

Pré-requisitos: Node.js 20+ e PostgreSQL 14+.

```bash
cp .env.example .env              # ajuste DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed                   # SEED_FORCE=1 para recriar
npm run dev                       # http://localhost:3000
```

Build de produção: `npm run build && npm start`. Checagem de tipos: `npm run typecheck`.

Testes automatizados (Vitest): `npm test` (unitários: CPF/CNPJ, chave NF-e, Pix, boleto, cálculo de ICMS/ST/DIFAL/IBS/CBS, assinatura digital, CNAB, TOTP) e `npm run test:db` (integração ponta a ponta no banco populado: pedido → NF-e assinada → estoque → financeiro → devolução, cupons, inventário).

---

## 🧭 Roteiro de demonstração (fluxo ponta a ponta)

1. **Vendas → Pedidos de venda → Novo pedido**: escolha um cliente e produtos. Ao salvar, a automação **reserva o estoque** (veja "Reservado" em *Estoque*).
2. No pedido, clique **Faturar (emitir NF)**: a NF-e é calculada (ICMS/IPI/PIS/COFINS conforme o regime), transmitida à SEFAZ simulada e autorizada. Na mesma hora as automações **baixam o estoque**, **lançam as contas a receber** (com boleto e Pix), **calculam a comissão**, **cotam o frete e geram a etiqueta** com código de rastreio, **sincronizam o estoque nos marketplaces** e disparam os **webhooks**. O painel "Automações executadas" do pedido mostra cada passo.
3. **Logística → Separação e embalagem**: confira os itens (bipe o EAN ou clique no SKU). Concluída a conferência, o pedido fica *Separado*. Em **Envios e rastreio**, use *Avançar* para simular os eventos da transportadora: postado → em trânsito → entregue (o pedido acompanha).
4. **Finanças → Contas a receber**: baixe um título, gere o boleto em PDF ou um link de pagamento. Abra o link (`/pagar/...`), "pague" via Pix e veja a conta baixada sozinha na Conta Digital.
5. **Finanças → Conciliação**: *Gerar OFX de exemplo* → *Importar OFX* → concilie com as sugestões.
6. **PDV**: abra o caixa, bipe produtos (ex.: `CAM-BAS-BRA-M` ou `3*MEI-KIT3-01`), receba em dinheiro/cartão/Pix, emita a NFC-e com QR Code e feche o caixa.
7. **Compras → Importar XML**: baixe o XML de exemplo, envie, lance a nota → entrada no estoque com custo rateado, contas a pagar pelas duplicatas e custo médio atualizado.
8. **Integrações**: ligue a *Simulação em tempo real* e acompanhe pedidos chegando dos marketplaces (com reserva de estoque e sincronização dos anúncios).
9. **Loja virtual**: edite cores, banner e seções; abra `/loja/modabrasil`, compre com Pix e pague pelo link — o pedido aparece no ERP com origem *Loja virtual*.
10. **Assistente IA**: pergunte "quais produtos estão acabando?", "qual a inadimplência?", "DRE do mês".
11. **Devolução**: abra um pedido entregue → *Devolução / troca* → escolha itens. É emitida a NF-e de devolução (finalidade 4, CFOP 1202/2202) referenciando a nota original, o estoque volta e o reembolso (ou crédito) é lançado. *Desmembrar* divide um pedido em aberto para faturamento parcial.
12. **Fiscal avançado**: em *Certificado digital* instale seu `.pfx` (ou gere o de demonstração — os dados demo já vêm com um) e veja o XML assinado; ative a **contingência** e venda no PDV (NFC-e tpEmis 9), depois *Transmitir notas em contingência*. Use *Manifestação do destinatário*, *Inutilização* e *Arquivos do contador* (SPED EFD, Sintegra, ZIP com XMLs).
13. **Financeiro avançado**: *Remessa e retorno CNAB* (gere a remessa, simule o retorno do banco e processe — os boletos são baixados), *Renegociar* títulos vencidos em *Contas a receber*, *Agenda de recebíveis* (liquidação/antecipação de cartão), *Orçamento* previsto × realizado, rateio por centro de custo e DRE por competência ou caixa.
14. **Estoque**: *Inventário* com contagem por bipagem e ajuste automático; *Transferência entre empresas* com NF-e de transferência (CFOP 5152/6152).
15. **Loja**: cupons `BEMVINDO10`, `FRETEGRATIS`, `VERAO30`; frete grátis para SP; área *Meus pedidos* (e-mail + CPF da compra); SEO, sitemap e domínio próprio.
16. **PDV**: etiqueta de balança — bipe `2001230019905` (granola, R$ 19,90 → ~0,499 kg); imprima o cupom térmico (texto/ESC-POS); sem internet as vendas ficam numa fila local e são enviadas quando a conexão volta.
17. **Segurança**: *Configurações → Segurança (2FA)* ativa o autenticador (TOTP); *Usuários → Convidar* envia link para definir senha; "Esqueci minha senha" no login; *Sistema e auditoria* mostra a trilha de auditoria, a caixa de saída de e-mails e a fila de tarefas; LGPD (exportar/anonimizar) na ficha do contato.

Troque de empresa (ou ative a **visão consolidada**) no seletor do topo: a conta demo tem duas empresas, *Moda Brasil* (Simples Nacional, SP) e *TechCasa* (Lucro Presumido, RJ), que compartilham cadastros e têm estoque, documentos e financeiro próprios.

---

## 📦 Módulos e funcionalidades

| Módulo | O que tem |
|---|---|
| **Cadastros** | Clientes/fornecedores/transportadoras (PF/PJ, validação de CPF/CNPJ, vários endereços, pessoas de contato, limite de crédito verificado no pedido, lista de preço e vendedor padrão); vendedores, funcionários e técnicos com comissão (no faturamento ou no recebimento); produtos simples, **com variação** (grade gerada automaticamente), **kits** (baixa dos componentes, disponibilidade calculada), **fabricados** (ficha técnica), matéria-prima, **lote e validade (FEFO)**; serviços (LC 116, ISS); listas de preço (varejo, atacado com qtd mínima, promoção com vigência, por canal, ajuste % e preço fixo); categorias; **cadastros personalizados** com campos configuráveis; **importação CSV/XLSX** (produtos, clientes, fornecedores, saldos, pedidos) com modelos e relatório por linha |
| **Estoque** | Entrada, saída, balanço/inventário e transferência; vários depósitos; **reserva automática**; saldo físico × reservado × disponível; modo **unificado ou separado** entre empresas; custo médio por depósito; movimentações rastreáveis até o documento; lotes; **curva ABC**; check-in de recebimento; **etiquetas** de produto (EAN-13/Code128 + preço, A4 3×10) e de estoque (QR Code); relatórios de posição, movimentação e ruptura |
| **Compras** | Pedidos de compra (envio ao fornecedor, conferência/check-in por bipagem com lote/validade, recebimento); **importação de XML de NF-e** (valida chave e destinatário, cadastra fornecedor/produtos, usa as duplicatas); ao receber: estoque com rateio de frete, contas a pagar e custo médio; reposição automática ao atingir o estoque mínimo |
| **Vendas** | Pedidos (manual, importação por planilha, API, loja, marketplaces, PDV, propostas); **propostas/orçamentos** com PDF e conversão (manual ou automática na aprovação); situações *aberto → faturado → separado → enviado → entregue / cancelado*; vendas multicanal com lucratividade por canal; **gestão de anúncios** (preço, pausa, estoque sincronizado); comissões com fechamento em contas a pagar |
| **PDV** | Abertura/fechamento de caixa com conferência, sangria e suprimento; leitura de código de barras, `qtd*SKU`, descontos, CPF na nota, múltiplas formas de pagamento com troco, maquininha POS simulada (taxas lançadas), **NFC-e** com QR Code; atalhos F2/F9 |
| **Notas fiscais** | NF-e 55, NFC-e 65 e NFS-e; cálculo de ICMS (alíquotas internas por UF, interestaduais 4/7/12%), IPI, PIS, COFINS (Presumido/Real) e ISS; Simples Nacional com CSOSN; CFOP por natureza de operação (intra/inter); chave de acesso com DV; XML no layout 4.00; **DANFE em PDF** (retrato, NFC-e bobina e NFS-e); certificado A1 simulado; validações da SEFAZ com códigos reais (207, 232, 280, 778…); emissão a partir do pedido em 1 clique ou avulsa; cancelamento com justificativa de 15+ caracteres e prazo (24h/30min); carta de correção; histórico de eventos |
| **Financeiro** | Contas a pagar/receber geradas automaticamente (vendas, compras, NF-e de entrada, OS, comissões, tarifas de marketplace), parcelamento, recorrência, baixa parcial com juros/multa/desconto, estorno; **fluxo de caixa** previsto × realizado; **conciliação OFX** com sugestões; plano de contas e centros de custo; **DRE** gerencial por competência; **boletos em PDF** (linha digitável e código de barras ITF); **Pix BR Code** e **links de pagamento** com página pública; **Conta Digital PJ** (saldo, extrato, Pix/TED/transferências); **POS** com taxas por modalidade; inadimplência e lucratividade por produto/canal |
| **Produção** | Ordens de produção pela ficha técnica, verificação de matéria-prima, baixa proporcional dos componentes e entrada do produto acabado (com lote) ao custo real; situações e **calendário** |
| **Ordens de serviço** | Abertura (equipamento, série, acessórios, defeito), diagnóstico, solução, técnico, prioridade, histórico de situações, faturamento com **NFS-e**, baixa de peças e contas a receber |
| **Logística** | Cotação Correios (PAC/SEDEX), Melhor Envio (Jadlog, Loggi, J&T, Azul) e **GestãoPro Envios** (tarifas com desconto, equivalente ao Bling Envios) com peso cúbico; **etiquetas 10×15** em PDF; código de rastreio UPU com DV; eventos de rastreio; **picking** consolidado por localização e **packing** com conferência por código de barras |
| **Integrações** | Central com **32 conectores** (Mercado Livre, Shopee, Amazon, Magalu, Americanas, Casas Bahia, Shein, TikTok Shop, Nuvemshop, Tray, Shopify, VTEX, WooCommerce, iFood, Rappi, Instagram, Google Shopping, Mercado Pago, Melhor Envio, Correios…); conexão OAuth simulada; publicação de anúncios; importação de pedidos (manual ou em tempo real); sincronização de estoque e preço; logs; **API REST documentada** (OpenAPI 3) com chaves de API; **webhooks** assinados (HMAC-SHA256) com histórico de entregas |
| **Loja virtual** | Editor visual (identidade, banner, seções ordenáveis, frete grátis, desconto no Pix, lista de preço e depósito) com pré-visualização desktop/mobile; vitrine com busca, categorias, variações (cor/tamanho com estoque por combinação), carrinho, cálculo de frete por CEP e **checkout** (Pix, boleto, cartão) integrado a clientes, pedidos, estoque e financeiro |
| **Multiempresas** | Várias empresas (CNPJs) na mesma conta, cadastros compartilhados, estoque unificado ou separado, troca rápida de empresa e **visão consolidada** nos dashboards e relatórios |
| **Relatórios e IA** | Dashboard "Meu Negócio" (KPIs, vendas 30 dias, canais, top produtos, estoque crítico, saldos); 15 relatórios (vendas por período/produto/canal/cliente/vendedor, estoque, ABC, ruptura, financeiro, inadimplência, DRE, fluxo, notas) exportáveis em **PDF e Excel**; **assistente de IA** que consulta os dados (Claude com tool use quando há `ANTHROPIC_API_KEY`, ou motor local de intenções em português) |
| **Automações** | **35 automações** reais, ativáveis por empresa, com log de execução (lista abaixo) |
| **Devoluções e trocas** | Devolução total/parcial por item com NF-e de devolução referenciada, retorno ao estoque opcional, estorno (contas a pagar) ou crédito (abate títulos), troca com novo pedido, redução de comissão; desmembramento de pedido (entrega parcial / pendência) |
| **Fiscal avançado** | **ICMS-ST** (MVA, CST 10/CSOSN 202, CFOP 5403/6403), **DIFAL + FCP** (EC 87/2015) para consumidor final de outra UF, **IBS/CBS** (reforma tributária, destaque informativo 2026), assinatura **XMLDSig** com certificado A1 real (`.pfx`) ou autoassinado de demonstração, **contingência offline** de NFC-e (tpEmis 9) com regularização, **inutilização** de numeração, **manifestação do destinatário** (ciência/confirmação/desconhecimento/não realizada) com importação do XML, **SPED Fiscal (EFD ICMS/IPI)**, **Sintegra** e pacote ZIP para o contador, NF-e de transferência entre filiais |
| **Financeiro avançado** | **CNAB 400** remessa/retorno (baixa automática), renegociação de dívidas (juros/desconto/novo parcelamento), **agenda de recebíveis** de cartão com liquidação D+1/D+30 e antecipação, **rateio por centro de custo**, **orçamento** previsto × realizado, DRE por competência ou caixa |
| **Sistema** | Fila de tarefas persistente com novas tentativas (webhooks, e-mails), caixa de saída (SMTP real ou simulado), **trilha de auditoria** de todas as escritas, **2FA (TOTP)**, convite de usuário e redefinição de senha por e-mail, limite de tentativas de login e de requisições na API, **LGPD** (exportação e anonimização), upload de arquivos/imagens, health check, backups |
| **Usuários e permissões** | Multiusuário (NextAuth), perfis Administrador/Vendedor/Financeiro/Estoquista e perfis próprios, matriz por módulo (sem acesso/visualizar/editar) aplicada no menu e na API, empresas permitidas por usuário |

### ⚡ Automações incluídas

Vendas: reservar estoque ao criar pedido · emitir NF-e automaticamente para pedidos de marketplace (opcional) · emitir NFC-e no PDV · baixar estoque ao faturar · calcular comissão · converter proposta aprovada em pedido · liberar reserva/estornar estoque ao cancelar.
Financeiro: lançar contas a receber ao faturar · cancelar contas e comissões do pedido cancelado · lançar contas a pagar ao receber compra · liberar comissão no recebimento · baixar conta ao receber Pix/link · régua de cobrança de vencidos · aviso de contas a pagar do dia.
Estoque/compras: entrada no estoque ao receber compra · atualizar custo médio · alerta de estoque mínimo · pedido de compra de reposição automático · alerta de lotes vencendo.
Integrações: sincronizar estoque com os canais em tempo real · sincronizar preço com os canais.
Logística: gerar etiqueta ao faturar · garantir etiqueta após o packing · marcar enviado na postagem · enviar rastreio ao cliente · marcar entregue.
Fiscal/produção/serviços/cadastros: enviar DANFE/XML ao cliente e ao contador · verificar matéria-prima ao iniciar OP · atualizar custo do produto acabado · avisar cliente quando a OS é concluída · e-mail de boas-vindas ao novo cliente.

Novas: liquidar recebíveis de cartão no vencimento · avisar cliente sobre devolução/troca · notificar filial sobre transferência recebida · resumo do inventário concluído.

E-mails passam pela **caixa de saída** e são enviados de verdade quando `SMTP_HOST` está configurado (senão ficam como SIMULADO); WhatsApp é sempre simulado.

---

## 🔌 API REST

Base: `/api/v1` · Autenticação: `Authorization: Bearer <chave>` (gere em *Integrações → API e webhooks*; chave demo: `gp_live_demo_0123456789abcdef`). Especificação: `GET /api/v1/openapi.json`.

```bash
# produtos com saldo
curl -H "Authorization: Bearer gp_live_demo_0123456789abcdef" http://localhost:3000/api/v1/products?q=camiseta

# criar pedido (reserva estoque, dispara webhooks)
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer gp_live_demo_0123456789abcdef" -H "Content-Type: application/json" \
  -d '{"externalId":"ERP-123","customer":{"document":"52998224725","name":"Maria"},"items":[{"sku":"CAM-BAS-BRA-M","quantity":2}],"paymentMethod":"PIX"}'

# faturar (emite NF-e simulada)
curl -X POST -H "Authorization: Bearer gp_live_demo_0123456789abcdef" http://localhost:3000/api/v1/orders/<id>/invoice
```

Endpoints: `products` (GET, POST, GET/PATCH `/{sku}`), `stock` (GET, POST), `orders` (GET, POST, GET `/{id}`, POST `/{id}/invoice`, POST `/{id}/cancel`), `contacts` (GET, POST), `invoices` (GET), `receivables` (GET). A página de documentação tem um console para testar as chamadas.

---

## 📱 App instalável (PWA)

O GestãoPro pode ser instalado como aplicativo (Chrome/Edge no computador, Android e iOS via "Adicionar à Tela de Início"). O botão **Instalar app** aparece no canto da tela quando o navegador permite.

- `public/manifest.webmanifest` (nome, ícones 192/512 e *maskable*, atalhos para PDV, novo pedido e contas a receber) e `public/sw.js` (service worker).
- Assets estáticos (`/_next/static`, ícones) em *stale-while-revalidate*; navegação com rede primeiro e cópia em cache; sem rede, abre a última versão da página ou `/offline.html`.
- A API não é cacheada, exceto `GET /api/me` e `GET /api/pdv` — assim o **PDV abre offline** depois da primeira visita e as vendas vão para a fila offline, sincronizada quando a conexão volta.
- O service worker só é registrado no build de produção (`npm run build && npm start`); em desenvolvimento use `NEXT_PUBLIC_PWA_DEV=1`. Instalação exige HTTPS (ou `localhost`).

## 🔁 Contratos e cobrança recorrente

**Vendas → Contratos** (`/vendas/contratos`): contratos com cliente, itens de serviço/produto, periodicidade (mensal, bimestral, trimestral, semestral, anual), dia de cobrança, início/término, forma de pagamento, nota (NFS-e, NF-e ou nenhuma) e reajuste anual (%).

- A lista mostra **MRR**, contratos ativos e o que falta faturar no mês; o detalhe traz o histórico de faturamentos (conta a receber + nota de cada período).
- Faturar gera a conta a receber (origem `CONTRATO`, com boleto/Pix) e transmite a NFS-e/NF-e. Cada período (`AAAA-MM`) é faturado **uma única vez**, mesmo com cliques ou rotinas repetidos.
- Dia 31 em meses curtos vira o último dia do mês (31/01 → 28/02 → 31/03).
- Automações diárias: **Faturar contratos** (vencimentos dos próximos 5 dias e períodos atrasados) e **Reajustar contratos no aniversário**. Também é possível suspender, reativar (sem cobrar o período suspenso) e encerrar.
- API: `GET/POST /api/contracts`, `GET/PUT /api/contracts/{id}`, `POST /api/contracts/{id}/bill|suspend|activate|close|adjust`.

## 🧾 Acesso do contador

O perfil **Contador** dá ao escritório de contabilidade acesso somente de consulta a notas fiscais (DANFE/XML), **Arquivos para o contador** (SPED Fiscal, Sintegra e pacote ZIP), financeiro, relatórios, estoque, compras e cadastros — sem PDV, configurações ou edição. No demo: `contador@gestaopro.com.br` / `demo123`. Para dar acesso ao seu contador, convide o usuário em **Configurações → Usuários** com o perfil Contador.

## 🧪 Testes E2E e CI

```bash
npm test                         # unitários (Vitest)
npm run test:db                  # inclui testes com banco (precisa do seed)
npx playwright install chromium  # 1ª vez
E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # servidor já no ar com o seed
E2E_START_SERVER=1 npm run test:e2e                   # sobe `npm start` (após `npm run build`)
```

Os testes E2E (`tests/e2e`) fazem login, abrem as principais páginas, criam e faturam um pedido pela interface (NF-e autorizada) e vendem no PDV (cupom). O workflow `.github/workflows/ci.yml` roda, com PostgreSQL 16 e Node 22: migrações, `tsc`, Vitest (unitários e com banco), build. O job **E2E** é disparado manualmente (Actions → CI → *Run workflow*).

---

## 🏗️ Arquitetura

- **Next.js 15 (App Router) + TypeScript**: a interface (`src/app/(app)`) e a API (`src/app/api`) ficam no mesmo projeto. Páginas client-side usam **React Query**; componentes no estilo **shadcn/ui** (Radix + Tailwind) em `src/components/ui`.
- **Prisma + PostgreSQL** (`prisma/schema.prisma`): cadastros pertencem à *organização* e são compartilhados entre as empresas; documentos (pedidos, notas, financeiro, estoque…) pertencem à *empresa*.
- **Camada de serviços** (`src/server/services`): toda a regra de negócio — `stock`, `sales`, `fiscal`, `finance`, `purchases`, `production`, `serviceOrders`, `logistics`, `integrations`, `store`, `reports`, `assistant`. A interface, a API pública e o seed usam os mesmos serviços.
- **Eventos + automações** (`src/server/events.ts`, `services/automations.ts`): os serviços emitem eventos de domínio (`order.invoiced`, `purchase.received`, `stock.changed`…); o motor executa as automações ativas da empresa, registra o log e entrega os webhooks.
- **Autenticação** com NextAuth (credenciais + JWT); `src/server/context.ts` resolve usuário, empresa ativa (cookie), visão consolidada e permissões; `src/server/http.ts` padroniza as rotas (`route(modulo, nivel, handler)`).
- **CRUD genérico** (`src/server/resources.ts` + `/api/r/[resource]`) para cadastros simples, com whitelist de campos e escopo por organização/empresa.
- **PDFs** com `pdf-lib` + `bwip-js` (`src/server/pdf.ts`): DANFE, DANFE NFC-e, NFS-e, boleto, etiquetas, relatórios. **Excel** com SheetJS.
- **Utilitários brasileiros** (`src/lib/br.ts`): CPF/CNPJ, chave de acesso, BR Code Pix, boleto FEBRABAN, rastreio dos Correios, EAN-13, ICMS por UF.

```
prisma/              schema, migrações e seed de demonstração
src/app/(app)/       telas do ERP (menu lateral)
src/app/api/         rotas da API interna, pública (v1) e páginas públicas (loja, pagamento)
src/app/loja/        vitrine da loja virtual
src/app/pagar/       página pública de pagamento (Pix/boleto/cartão simulados)
src/components/      UI (shadcn), layout, componentes comuns e de módulo
src/lib/             utilitários (formatação, BR, permissões, cliente da API)
src/server/          contexto, http, eventos, PDF, planilhas, OpenAPI e serviços
```

### Notas de implementação

- Valores monetários usam `Float` com arredondamento em 2 casas na camada de serviço (adequado ao demo; em produção prefira `Decimal`).
- As automações rodam de forma síncrona após cada operação (previsível); trabalhos que podem falhar — entrega de webhooks e envio de e-mails — vão para a **fila persistente** (tabela `Job`) processada por um worker interno (`src/instrumentation.ts`) com backoff exponencial. Para várias réplicas, defina `DISABLE_WORKER=true` nas réplicas web e mantenha um processo worker.
- A rotina diária (cobrança, lotes vencendo, contas do dia) roda no primeiro acesso do dia por empresa ou pelo botão em *Automações*.
- O CEP é consultado no ViaCEP quando há internet; sem rede, os campos são preenchidos manualmente.
- Domínio próprio da loja: aponte o DNS (CNAME) para o servidor e informe o domínio no editor da loja; o `middleware` reconhece o host e abre a vitrine. O sitemap (`/sitemap.xml`) lista as lojas publicadas.
- O limitador de requisições é em memória (por instância); com várias réplicas, troque por Redis mantendo a mesma função (`src/lib/rateLimit.ts`).

### Limitações conhecidas (fora do alcance sem credenciais externas)

- Autorização real na SEFAZ/prefeituras (requer webservices estaduais/municipais, credenciamento e certificado ICP-Brasil): o XML é gerado e **assinado de verdade**, mas a autorização é simulada.
- APIs de bancos (boleto registrado, Pix dinâmico, extrato automático), adquirentes, marketplaces, Correios/Melhor Envio e WhatsApp Business exigem contratos e chaves; os conectores simulam o comportamento e os pontos de integração estão isolados em `src/server/services`.
