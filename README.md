# FinOps Manager — v4.2.0

Sistema web corporativo para gestão FinOps com inventário de recursos Azure, alocação de custos por tag, dashboard Databricks, e calculadora de custos Azure em tempo real.

**Stack:** Node.js 18+ · Express · PostgreSQL 13+ · Vanilla JS SPA · Vivo Purple UI

---

## Índice

1. [O que há de novo desde a v4.2.0](#o-que-há-de-novo-desde-a-v420)
2. [O que há de novo na v4.2.0](#o-que-há-de-novo-na-v420)
3. [Pré-requisitos](#pré-requisitos)
4. [⚠️ Pré-produção — passo a passo obrigatório](#️-pré-produção--passo-a-passo-obrigatório)
5. [Variáveis de Ambiente](#variáveis-de-ambiente)
6. [Windows (local / on-premise)](#windows-local--on-premise)
7. [Linux (Ubuntu / Debian)](#linux-ubuntu--debian)
8. [Docker](#docker)
9. [Azure (App Service + PostgreSQL Flexible)](#azure)
10. [AWS (EC2 + RDS)](#aws)
11. [GCP (Cloud Run + Cloud SQL)](#gcp)
12. [SaaS — Railway · Render · Fly.io](#saas)
13. [SSL / Proxy reverso (Nginx)](#ssl--proxy-reverso)
14. [Segurança em produção](#segurança-em-produção)
15. [APIs Externas — Liberação de Firewall](#apis-externas--liberação-de-firewall)
16. [API Endpoints](#api-endpoints)

---

## O que há de novo desde a v4.2.0

> Ainda não cortado como versão. O `package.json` segue em 4.2.0 — se for virar release, basta
> renomear esta seção e bumpar a versão.

### ✉️ Mailing de Comunicados (Novo)
- **Broadcast corporativo** separado do SMTP de Alertas, de ponta a ponta: configuração própria (`integracoes` tipo `mailing_relay`), transporter próprio e estado de execução próprio. Mexer num não afeta o outro
- **Relay SMTP anônimo** — sem usuário/senha, autorizado por IP de origem. Não existe campo de senha neste módulo. O "Testar Conexão" pode falhar na estação e funcionar em produção: é liberação de rede, não configuração errada
- **Cadastro único de contatos** com importação em massa de Excel/CSV, relatório por lote e descadastro público via token HMAC autoverificável
- **Editor visual** (TipTap) com modelo padrão de Comunicado FinOps e biblioteca de modelos salvos. A assinatura usa tabela de verdade para pôr o logo ao lado do texto — imagem dentro de parágrafo é bloco e nunca fica lado a lado
- **Um e-mail individual por pessoa**, nunca cópia coletiva: ninguém vê o endereço dos outros e cada um recebe o próprio link de descadastro. Envio em lotes de 20 em paralelo com pausa de 2s, com registro de status por destinatário e reenvio só das falhas
- **Limitação assumida**: SMTP não dá webhook de entrega nem bounce. O que se registra é "o servidor entregou ao relay", não "a pessoa recebeu"

### 💰 Economia realizada com órfãos excluídos (Novo)
- Cruza três fatos que já existiam separados: o recurso **foi identificado** como órfão, **foi excluído** em tal data por tal pessoa (Activity Log) e **custava** tanto de verdade (faturamento, não preço de tabela)
- Custo apurado na janela de 30 dias **antes** da exclusão — depois dela o recurso não fatura, e uma janela corrente devolveria zero
- **Piso de 30 dias como órfão**, o prazo do fluxo real: exclusão mais rápida veio do ciclo de vida da infra, não do processo. Vale para todas as categorias
- **Snapshot de retenção abatido** enquanto existir, já que ele ainda custa nos 90 dias — e quando é excluído não vira economia própria, senão a mesma economia contaria duas vezes
- **Detalhe auditável** no portal privado: recurso, resource group, data, quem excluiu, dias como órfão, selo AKS/PVC ou ASR e custo. Quem não cumpre o piso aparece marcado, não some — esconder impediria calibrar a regra
- **Exceção manual** para o que a regra não pega (disco órfão o bastante, apagado pelo time da aplicação): motivo obrigatório, autor vindo do token, e tudo visível na linha para auditoria posterior
- **Bases distintas nos dois portais**, de propósito: o privado conta tudo e expõe as ressalvas; o público só mostra o que aquele portal de fato publicou, com os mesmos filtros de `/api/public/orfaos`
- Tabela materializada (`azure_desperdicio_saving`) em vez de recalculada por join: economia realizada é fato histórico e não pode cair sozinha quando a retenção de excluídos do inventário ou um expurgo de custos levar a origem embora

### 🗑️ Desperdício — visão de FinOps
- A lista passa a mostrar **só o que gera custo por estar órfão**. O recorte é por **tipo de recurso**, nunca por custo nulo: `null` neste sistema significa "não achamos o billing", não "é grátis"
- Medido amostrando 300 recursos vivos de cada tipo contra o faturamento: **NIC 0/300** faturam; IP público 287/300; disco 293/300; snapshot 273/300; Load Balancer 245/246. Só NIC saiu
- Disco e snapshot **sem custo identificado continuam na lista**, com aviso — filtrar por custo nulo esconderia 182 itens reais, um deles órfão há 1242 dias

### 📜 Log Analytics — acompanhamento e coleta de período

- **Barra de progresso** nas três coletas da tela (geral, Diagnostic Settings, atribuição por recurso). Antes o botão só virava "Coletando..." e a tela não dizia mais nada por minutos — e essas coletas são longas: a geral levou **83 min** num startup e os Diagnostic Settings, **456s**. Agora mostra fase, contagem (`72 de 191`), percentual, tempo e o item em processamento; erro aparece na tela, não só no log
- Enquanto a descoberta não termina não existe total, então a barra fica **indeterminada** em vez de exibir 0% — percentual inventado passaria impressão de travado. A execução concluída permanece visível por 10 min: sumir no instante do fim é indistinguível de "a tela perdeu o estado"
- **Backfill de volume** sob demanda (campo de dias + botão), separado do "Atualizar agora" que sempre olha os 30 dias fixos. Uma consulta por workspace, sem fatiar — `Usage` devolve poucas centenas de linhas mesmo em 90 dias
- **Backfill de atribuição por recurso** sob demanda, para "quem gerou os GB". Bem mais caro: itera tabela por tabela. Medido: **190 de 191 workspaces em ~23 min** para uma janela de 45 dias, contra **81s** do backfill de volume para 120 dias. Por isso é sob demanda e **não mudou** o padrão automático de 3 dias da coleta diária

> **O limite não é o sistema, é a retenção da Azure.** Dado anterior à retenção configurada já foi
> expurgado lá, e nenhuma mudança aqui recupera isso. Medido nesta base: **91% das tabelas
> (122.424 de 134.337) retêm só 30 dias**; a tabela `Usage`, que alimenta o volume, retém 90 dias
> em 188 workspaces e 365 em 3.

- Pedir mais dias do que existe **não dá erro** — a Query API devolve vazio para o período já expurgado, o que pareceria "consumo zero" em vez de "não sabemos". Por isso a consulta é **limitada à retenção real** antes de sair, e o resumo informa quantos vieram truncados
- O limite do volume é por workspace; o da atribuição é **por tabela**, porque cada tabela do top-N tem retenção própria. Verificado com um pedido de 45 dias: tabelas de 30 dias pararam em 30, as de 31 em 31, e as de 90/365 receberam os 45 completos
- Usa a **retenção interativa**, não a total com arquivo: o Archive Tier exige *search job* assíncrono e cobrado por GB varrido, fora do escopo desta coleta — usar o total prometeria um alcance que a consulta não entrega
- Cobertura resultante: volume de 52 → **121 dias**; atribuição por recurso de 16 → **46 dias**

### 🔔 Alertas por e-mail — volume e roteamento
- **Mudança de propriedade de infra virou só sino.** Disparava uma vez por propriedade alterada dentro da coleta, sem nenhum controle de repetição, numa coleta que processa 150 a 200 mil eventos por dia
- **Anomalias de crescimento viraram um resumo único**, ordenado por Z-score. Eram ~157 e-mails por dia para um destinatário, e de forma recorrente: o dedup libera a chave a cada 24h e a janela de detecção são 35 dias
- **Roteamento por responsável** (`_destinatariosPara()`): casa por nome ou e-mail, exige usuário ativo e cai na lista global quando não identifica. Aplicado ao orçamento Databricks, que tinha a coluna e não a usava
- **Liga/desliga por alerta** — os 11 alertas do catálogo (`_ALERTAS_CATALOGO`) podem ser desativados um a um na tela de Integrações. O banco guarda a lista de **desativados**, não a de ativos: alerta novo nasce ligado em vez de ficar mudo até alguém lembrar de marcá-lo. Falha ao ler a configuração devolve "ativo" — indisponibilidade de banco não deve silenciar alerta
- **Onde o liga/desliga NÃO vale**: a guarda fica no trecho que manda e-mail, não na detecção. Mudança de propriedade e anomalia de crescimento continuam registrando no sino com o alerta desmarcado — "não quero o e-mail" é diferente de "não quero saber"
- **Alertas podem sair por relay SMTP anônimo** (`integracoes` tipo `alertas_relay`), com destinatários próprios, separados do Mailing. A precedência é: relay ativo e configurado primeiro, SMTP autenticado como alternativa, e `null` se nenhum dos dois estiver pronto. Sem transporte configurado **nenhum alerta sai** — hoje é exatamente esse o estado desta base (`smtp` inativo, `alertas_relay` sem cadastro)
- A seleção de alertas aparece **nos dois cards** (relay e SMTP) porque é a mesma configuração e vale para os dois transportes: marcar num reflete no outro na hora, e salvar por qualquer um grava o mesmo

### 🔐 Documentação de segredos corrigida
- O `.env.example` afirmava *"SECRETS NEVER GO IN THE DATABASE"* — o oposto do que o sistema faz. Credenciais de aplicação ficam no banco, cifradas com a `MASTER_KEY`, e são cadastradas pelas telas
- Das 58 variáveis do arquivo, **só 12 eram lidas**. As outras 46 (SMTP_*, LDAP_*, ENTRA_*, AZURE_*, DATABRICKS_*, PORTAL_*, FEATURE_*…) não tinham nenhum leitor — segredo real em arquivo que ninguém lê é risco sem contrapartida

### ⚡ Correções
- `[LogAnalytics] Falha ao coletar DCRs: subs is not defined` — `ReferenceError` real que derrubava a coleta de DCR inteira a cada execução
- `[TagRollup] invalid input syntax for type date: "null-01"` — faltava filtrar `cost_date` nulo ao montar a lista de meses. Há **56 mil linhas** de `azure_costs` sem data, invisíveis para toda consulta recortada por mês
- Microsoft Graph: checagem da claim `roles` antes de chamar, já que sem `Directory.Read.All` a API responde 200 com lista vazia em vez de erro
- Segredo que não decifra com a `MASTER_KEY` atual passa a avisar, em vez de usar o texto cifrado como se fosse a senha
- **`server.js` roda em modo não-estrito, apesar do `'use strict'`.** O arquivo começa com BOM e com uma linha executável (`process.env.TZ = ...`) **antes** da diretiva na linha 3 — e diretiva só vale se for a primeira instrução. Consequência prática: variável sem `const`/`let` vira global solta em vez de lançar `ReferenceError`. Havia uma assim na coleta de atribuição por recurso (corrigida); testada sob concorrência de 8 workspaces sem corrupção cruzada, mas sem motivo para continuar assim

## O que há de novo na v4.2.0

### 🏢 Multi-Service Principal (multi-tenant)
- **Coletas simultâneas por SP** — o estado da coleta deixou de ser global e passou a ser por execução (`Map` com chave `tipo:id`, ex. `api:7`). Duas SPs agendadas para o mesmo horário agora rodam juntas, cada uma com seu próprio log e progresso, em vez de uma esperar a outra
- **Botão "Coletar Todas"** — dispara coleta em todas as SPs ativas de uma vez, em paralelo. Só faz sentido a partir desta versão: com o estado global, a segunda SP morria com "coleta já em execução". A confirmação mostra o plano antes (quais SPs, modo, período de cada uma, e quais ficam de fora com o motivo), e a execução não desloca os agendamentos configurados
- **Cancelamento seletivo** — `POST /api/azure-coleta/cancelar` aceita `{ tipo, id }`; sem corpo, mantém o comportamento antigo de cancelar tudo
- `GET /api/azure-coleta/status` ganhou o array `execucoes[]` (uma entrada por coleta ativa); `em_execucao`/`progresso` continuam lá para não quebrar consumidores
- **Filtro global de Tenant (SP)** — presente em todas as telas de monitoramento (Dashboard, Inventário, Log Analytics, Coleta, exports Excel). A atribuição é feita por `subscription_id`, nunca por `sp_id`, porque as tabelas de dados não carregam coluna de SP
- **Coleta de Inventário e Log Analytics percorre todas as SPs ativas** via `_resourceGraphQueryTodasSps()`
- Seletor de assinaturas do Portal Público agora agrupa por SP

### 📜 Log Analytics FinOps — expansão
- **Sentinel e Commitment Tier separados do custo de ingestão** — antes somavam tudo num bolo só. Hoje cada balde tem card próprio, amarrado ao mês selecionado
- **Sugestão de nível de Commitment Tier** — calculada sobre a série diária de 60 dias (excluindo o dia UTC em curso, que vem parcial), com janela curta de 14 dias para detectar tendência e luz amarela antes da média alcançar o próximo degrau
- **Preço real do GB: Analytics × Basic, por tabela** — mostra quanto custaria cada tabela em cada plano, para a decisão de downgrade
- **Quem paga a análise do Sentinel** — detalhamento tabela por tabela (ex.: na nossa conta, 91,4% da fatura de análise do Sentinel está em `AzureDiagnostics`, não em tabelas nativas do produto)
- **Snapshot diário** (`log_analytics_commitment_snapshot`) — grava a conclusão de Commitment Tier todo dia, para a tendência virar histórico auditável
- **Cards de volume** — ingestão total, média diária do mês e retenção faturada; o card avisa quando o mês foi medido pela metade (`dias_com_gb` vs `dias_janela`)
- **Seletores de Mês e Workspace** valem para a tela inteira; o filtro de Workspace aceita múltipla seleção e o card de observabilidade declara o recorte aplicado
- **Ingestão por recurso** — ranking de quem gera volume dentro do workspace, com o caminho pelo qual o dado chega (Diagnostic Setting, DCR, agente)
- **Gasto de observabilidade por balde** — inclui export de log que paga e não alimenta workspace nenhum

### ⚡ Performance e correções
- Índice `idx_azure_costs_cat_date` em `azure_costs(meter_category, cost_date)` — a consulta de observabilidade caiu de **202s para 10–27s** (era bitmap heap scan lossy com ~600 mil linhas rechecadas)
- Aba Comparativo resolve os dois períodos numa varredura só e soma custo de um rollup diário, em vez de varrer as 9,1M linhas de `azure_costs`
- **PVC do AKS voltaram a ficar escondidos do portal público** — a regra de disco órfão casava `pvc-` só no início do nome e deixava passar `kubernetes-dynamic-pvc-<uuid>`, listando 8 volumes vivos como descartáveis
- Corrigido USD apresentado como BRL nas conclusões de Commitment Tier (`azure_price_list` é inteiramente USD; a calibração passou a vir da fatura)
- Rede de testes nova para `LogAnalyticsView`

## O que há de novo na v4.1.0

### 📜 Log Analytics FinOps (Novo)
- Inventário de workspaces, tabelas, retenção e custo real (JOIN com `azure_costs`) por workspace/tabela
- **Diagnostic Settings** — quais logs/métricas estão habilitados por recurso, detecção de fan-out (mesmo recurso enviando para 2+ workspaces)
- **DCR (Data Collection Rules)** e inventário de Application Insights (sampling %, daily cap, retenção, vínculo com workspace)
- **Auditoria de Consultas KQL** — habilita `LAQueryLogs` por workspace (opt-in, ação de escrita na Azure) e conta quantas queries rodam por tabela nos últimos 30 dias, refinando a recomendação de downgrade pra plano Basic
- Painel nativo com rankings, dashboard HTML autocontido pra download, e export Excel

### 💰 Imposto sobre Custo Coletado — correção e consistência
- Corrigido o valor configurado do split Microsoft/Marketplace (estava um fator de crescimento colado direto no campo de pontos percentuais, gerando um imposto ~15x menor que o real)
- Tela de Configurações agora valida e explica a unidade do campo (preview ao vivo + aviso de sanidade) pra não repetir o erro
- **Calculadora** (interna e pública): cada recurso selecionado agora mostra o custo **já com o imposto da sua categoria** (Microsoft ou Marketplace, conforme `publisher_type`) embutido na linha, alinhado com o padrão já usado em Recursos Órfãos e Log Analytics — Total Final não muda, só a composição do Subtotal

## O que há de novo na v4.0.0

### 🏢 Inventário de Recursos Azure (Novo)
- **Recurso Graph Change Analysis** — rastreamento de criação, atualização e exclusão de recursos
- **Reconciliação automática** — backfill de recursos que existiam antes da ativação da coleta
- **Timeline de mudanças** — histórico completo de alterações de propriedades (SKU de VM, tags, etc.)
- **Conformidade de tags** — verificação de tags obrigatórias por recurso
- **Anomalia Detection** — Z-score de crescimento acelerado de recursos
- **Desperdício** — identificação de discos órfãos, snapshots antigos, IPs públicos sem uso, NICs desacopladas

### 💰 Alocação & Otimização
- **Showback por tag** — rateio de custos por projeto/squad/centro de custo
- **Cobertura RI/SP** — medida em horas (não R$), comparação com benchmark de mercado (60-80%)
- **Orçamentos por scope** — limite global, por workspace Databricks, ou por tag (projeto/squad)
- **Forecast com tendência linear** — projeção de 3 meses baseada em padrão histórico

### 📊 Coleta Databricks (Novo)
- **System Tables** — coleta de billing, consumo por job/cluster/usuário, anomalias
- **Quotas Genie** — controle de limite de uso do Genie (AI Gateway) com bloqueio automático
- **Detecção de anomalias** — Z-score de custo diário + crescimento por usuário
- **Dashboard próprio** — drill-down por workspace/SKU/usuário, forecasting
- **Importação manual** — CSV/Parquet/ZIP para ambientes sem credenciais de API

### 📋 Azure Retail Price List (v2.0+)
- Sincronização automática com a [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
- ~100 mil SKUs sincronizados
- Cobertura para todos os tipos: hora, dia, período (disco/storage), reserva

### 🔒 Reservas Cloud (v2.0+)
- Controle de reservas (Azure, AWS, GCP, Oracle, Multicloud)
- Alertas automáticos para reservas expirando em ≤ 90 dias
- Badges por severidade: Expirada / Crítico / Atenção / Aviso

### 🔐 Segurança & Secrets (v4.0.0)
- ~~**Secrets em `.env`, nunca no banco** — todas as credenciais (Azure, Databricks, SMTP, Entra ID) carregadas em boot~~ — **não vale mais**: hoje as credenciais de aplicação ficam no banco, cifradas com a `MASTER_KEY`, cadastradas pelas telas (ver "Documentação de segredos corrigida" e "Onde ficam os segredos")
- `MASTER_KEY` para criptografia AES-256-GCM de dados sensíveis
- SSO via Microsoft Entra ID + OAuth 2.0 completo
- Controle de acesso (`adminMiddleware`) em rotas de administração
- SMTP com timeouts explícitos e log de tentativas

### 🔁 Reservas Cloud — sincronização com a Azure
- Botão **Sincronizar com Azure** na tela de Reservas importa reservas e Savings Plans usando a Service Principal configurada (Coleta Azure); o cadastro manual continua disponível
- Permissões da SP: **Reservations Reader** (escopo `/providers/Microsoft.Capacity`) e **Savings plan Reader**
- Custos digitados manualmente são preservados nas próximas sincronizações

### 🔤 Fontes e UI (v2.0+)
- IBM Plex Sans/Mono self-hosted (zero dependência externa)
- Tema Vivo Purple (roxo corporativo) + tema claro alternativo
- Responsive design (funciona em mobile)
- Logo FinOps por tema: claro usa `finops-logo.png`, escuro usa `finops-logo-dark.png` (top-bar, login, portal público e telas de FAQ)
- Tela de FAQ com logo centralizado e título "FinOps Manager · FAQ" abaixo

---

## Pré-requisitos

| Componente | Versão mínima |
|---|---|
| Node.js | 18 LTS+ |
| npm | 9+ |
| PostgreSQL | 13+ |

---

## Variáveis de Ambiente

**IMPORTANT:** All Service Principal credentials, API keys, and secrets are **loaded from `.env` at boot — never stored in the database.**

### Quick Start

1. **Copy `.env.example` as a template:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with real values:**
   - Database credentials: `DB_PASSWORD`, `DATABASE_URL`
   - Secrets: `JWT_SECRET`, `MASTER_KEY` (generate fresh ones with the script below)
   - Azure: `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET`
   - Databricks (optional): `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`
   - SMTP (optional): `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`

3. **Never commit `.env` to git:**
   ```bash
   # Already in .gitignore, but verify:
   grep .env .gitignore
   ```

4. **Always commit `.env.example`:**
   - This is the reference template
   - Contains no real secrets, only variable names and docs
   - Helps AI systems understand what variables are available

### Onde ficam os segredos

Dois lugares, com papéis diferentes — e confundi-los já custou um SMTP quebrado sem ninguém perceber.

| | O quê | Como |
|---|---|---|
| **Banco** | Service Principals da Azure (`azure_coleta_config`), senha do SMTP de Alertas e relay do Mailing (`integracoes`) | Cifrados com a `MASTER_KEY`, cadastrados **pelas telas do sistema** |
| **`.env`** | Conexão com o banco, `JWT_SECRET`, `MASTER_KEY`, `PORT`, `TZ`, `ALLOWED_ORIGIN` | Texto puro (ou `.env.enc` + `.env.key`), lido na subida do processo |

Editar credencial de aplicação no `.env` **não tem efeito nenhum** — nenhuma linha do código lê
essas variáveis. Use as telas.

**Consequência operacional:** a `MASTER_KEY` faz parte do backup, junto com o dump do banco. Sem
ela, o dump não recupera credencial alguma — todas precisam ser recadastradas uma a uma. O sintoma
de chave trocada é `[Cripto] FALHA ao decifrar um segredo` no log de startup, seguido de falhas de
envio com `535 Incorrect authentication data`.

O `.env.example` lista **apenas as variáveis que o código realmente lê**. Em 2026-10-18 ele tinha
58 entradas das quais só 12 eram usadas; as demais eram resquício de quando a configuração vinha
daquele arquivo, e foram removidas.

### Generate Secrets

Never use the defaults in production. Generate strong random values:

```bash
# Generate both JWT_SECRET and MASTER_KEY
node -e "
  const c = require('crypto');
  console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex'));
  console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));
"
```

---

## ⚠️ Pré-produção — passo a passo obrigatório

Execute **todos** os passos desta seção antes de expor o sistema a usuários reais. Cada item é obrigatório.

---

### Passo 1 — Gerar segredos criptograficamente seguros

Nunca use os valores padrão em produção. Gere valores únicos:

```bash
# Node.js (recomendado — já disponível no servidor)
node -e "
  const c = require('crypto');
  console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex'));
  console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));
"
```

```powershell
# PowerShell (Windows)
# Execute duas vezes — uma para JWT_SECRET, outra para MASTER_KEY
[System.Convert]::ToBase64String(
  [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
)
```

**Regras:**
- Mínimo 32 caracteres (os comandos acima geram 96)
- `JWT_SECRET` — quem tiver esse valor pode forjar tokens de login. Nunca expor.
- `MASTER_KEY` — se mudar após o setup, o arquivo `.finops_setup` torna-se ilegível. Guarde em cofre.
- O servidor imprime **AVISO** no console se algum estiver com o valor padrão

---

### Passo 2 — Criar e proteger o arquivo `.env`

```bash
# Linux/macOS
cat > .env <<EOF
DB_HOST=seu-host-postgres
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_forte_do_banco

JWT_SECRET=<gerado_no_passo_1>
JWT_EXPIRES=8h
MASTER_KEY=<gerado_no_passo_1>

PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

chmod 600 .env   # apenas o dono pode ler
```

```powershell
# PowerShell (Windows)
@"
DB_HOST=seu-host-postgres
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_forte_do_banco
JWT_SECRET=<gerado_no_passo_1>
JWT_EXPIRES=8h
MASTER_KEY=<gerado_no_passo_1>
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
"@ | Set-Content .env -Encoding UTF8
```

---

### Passo 3 — Criptografar o `.env` (recomendado)

```bash
# Criptografa .env → .env.enc + .env.key (AES-256-GCM)
node encrypt-env.js encrypt

# Apaga o .env em texto plano
rm .env          # Linux
Remove-Item .env # PowerShell

# Guarde .env.key em local seguro (Azure Key Vault, AWS Secrets Manager, cofre)
# NUNCA envie .env.key para o repositório Git
```

Para iniciar o servidor com env criptografado:
```bash
node encrypt-env.js run
```

Ou altere o script `start` no `package.json`:
```json
"start": "node encrypt-env.js run"
```

---

### Passo 4 — Configurar o PostgreSQL com acesso mínimo

```sql
-- Execute como superusuário (postgres)
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_forte_aqui';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;

-- Após o primeiro start (tabelas criadas), restringir ao mínimo:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO finops_user;
```

**Regras de rede PostgreSQL:**
- Nunca expor a porta 5432 publicamente (`0.0.0.0/0`)
- Liberar apenas o IP/VPC da aplicação no `pg_hba.conf` ou firewall
- Usar SSL: `?sslmode=require` na connection string

---

### Passo 5 — Verificar o arquivo `.gitignore`

Confirme que os arquivos sensíveis estão no `.gitignore` antes de qualquer `git push`:

```gitignore
.env
.env.key
.env.enc
.finops_setup
node_modules/
uploads_tmp/
*.log
*.png
```

Verificar arquivos acidentalmente commitados:
```bash
git ls-files .env .env.key .env.enc .finops_setup
# Se retornar algo, remova do histórico com: git rm --cached <arquivo>
```

---

### Passo 6 — HTTPS obrigatório

O Node.js serve apenas HTTP. Coloque um terminador TLS na frente:

**Opção A — Nginx + Certbot (Linux):**
```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/finops > /dev/null <<'EOF'
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 600M;   # uploads CSV/Parquet grandes
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/finops /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Certificado gratuito (Let's Encrypt)
sudo certbot --nginx -d seu-dominio.com
```

**Opção B — Plataformas gerenciadas:**
- Azure App Service → HTTPS automático em `*.azurewebsites.net`
- Railway / Render / Fly.io → HTTPS automático
- AWS ALB → ACM certificate listener na porta 443

---

### Passo 7 — Configurar reinício automático

**PM2 (recomendado para Linux e Windows):**
```bash
npm install -g pm2
pm2 start server.js --name finops-manager --max-restarts 10 --restart-delay 5000
pm2 save
pm2 startup   # Linux/Mac — siga o comando impresso para registrar no systemd/launchd
```

**Windows — `pm2 startup` não funciona nativamente** (é feito para systemd/launchd). Use o pacote
`pm2-windows-startup`, que registra `pm2 resurrect` (restaura a lista salva por `pm2 save`) no login do
Windows via `HKCU\...\Run`:
```powershell
npm install -g pm2-windows-startup
pm2-startup install
```
Isso só roda no login do usuário atual (não é um serviço Windows que sobe antes do login) — suficiente para
uma máquina onde o usuário sempre inicia sessão. Para rodar como serviço Windows de verdade (sobe no boot,
sem precisar de login), use NSSM em vez de PM2 — ver seção "Windows Service — NSSM" mais abaixo.

**systemd (Linux, alternativa robusta):**
```bash
sudo tee /etc/systemd/system/finops.service > /dev/null <<'EOF'
[Unit]
Description=FinOps Manager v4.0.0
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable finops
sudo systemctl start finops
sudo journalctl -u finops -f   # logs em tempo real
```

---

### Passo 8 — Verificar saúde da aplicação

Após o deploy, confirme que tudo está funcionando:

```bash
# Health check (sem autenticação)
curl https://seu-dominio.com/health

# Resposta esperada:
# {"status":"ok","db":"connected","uptime":42,"timestamp":"2025-01-01T00:00:00.000Z"}
```

Se retornar `{"status":"degraded","db":"unavailable"}`, o servidor subiu mas não conseguiu conectar ao PostgreSQL — verifique as variáveis `DB_*`.

---

### Passo 9 — Configurar backup do banco

```bash
# Backup manual
pg_dump -h localhost -U finops_user -d finops_db -F c -f finops_backup_$(date +%Y%m%d).dump

# Cron diário às 2h (Linux)
sudo crontab -e
# Adicionar:
0 2 * * * pg_dump -h localhost -U finops_user -d finops_db -F c -f /backups/finops_$(date +\%Y\%m\%d).dump

# Testar restore
pg_restore -h localhost -U finops_user -d finops_db_restore -F c finops_backup.dump
```

**Plataformas gerenciadas:** habilitar backups automáticos no painel do RDS / Azure Database / Cloud SQL (retenção mínima 7 dias).

---

### Passo 10 — Copiar o mascote.png

O arquivo `mascote.png` (mascote Vivo exibido na tela de login) **não é versionado no Git** (listado em `.gitignore`). Você deve copiá-lo manualmente para a pasta raiz da aplicação em cada servidor/ambiente.

```powershell
# Windows — copiar para a pasta da aplicação
Copy-Item "C:\caminho\original\mascote.png" "C:\FinOps\mascote.png"
```

```bash
# Linux
cp /caminho/original/mascote.png /opt/finops/mascote.png
```

```bash
# Docker — inclua no build ou monte como volume
# Opção 1 — copiar antes do build (sem git):
cp mascote.png ./mascote.png
docker build -t finops-manager .

# Opção 2 — volume (persiste entre atualizações):
docker run -d ... -v /caminho/mascote.png:/app/mascote.png finops-manager
```

> **Por que não está no Git?** O `.gitignore` exclui `*.png` para evitar que assets binários grandes aumentem o histórico do repositório. Se preferir versioná-lo, remova a entrada `*.png` do `.gitignore` e execute `git add mascote.png`.

**Comportamento sem o arquivo:** A tela de login exibe apenas o logo SVG "vivo" em roxo, sem o mascote ao lado. O sistema funciona normalmente — o arquivo é apenas visual.

---

### Passo 11 — Configurar monitoramento de disponibilidade

Configure um monitor externo para ser alertado se o sistema cair.

**UptimeRobot (gratuito, recomendado):**

1. Acesse [uptimerobot.com](https://uptimerobot.com) e crie uma conta gratuita
2. **New Monitor → HTTP(s)**
3. Preencha:
   - **URL:** `https://seu-dominio.com/health`
   - **Monitoring Interval:** 5 minutos
   - **Alert Contacts:** seu e-mail ou canal Slack/Teams
4. Resposta esperada: HTTP `200` com corpo `{"status":"ok"}`
5. Se retornar `503` ou `{"status":"degraded"}`, o banco não está acessível — verifique as variáveis `DB_*`

**Alternativas:**

| Serviço | Plano gratuito | Intervalo mínimo |
|---|---|---|
| [UptimeRobot](https://uptimerobot.com) | 50 monitores | 5 min |
| [Better Uptime](https://betteruptime.com) | 10 monitores | 3 min |
| [Freshping](https://freshping.io) | 50 monitores | 1 min |
| Azure Monitor / AWS CloudWatch | Pago | 1 min |

**PM2 — monitoramento local:**
```bash
pm2 monit                   # dashboard em tempo real
pm2 logs finops-manager     # logs do processo
pm2 status                  # resumo de todos os processos
```

---

### Passo 12 — Checklist final

```
Segredos
[ ] JWT_SECRET definido com string aleatória ≥ 32 chars
[ ] MASTER_KEY definido com string aleatória ≥ 32 chars
[ ] DB_PASSWORD forte e único
[ ] .env criptografado com encrypt-env.js ou injetado via plataforma
[ ] .env.key guardado em cofre (não no servidor)

Rede e acesso
[ ] ALLOWED_ORIGIN = https://seu-dominio.com (não null)
[ ] HTTPS ativo — Nginx/Caddy/terminador da plataforma
[ ] Porta 3000 não exposta diretamente (só via proxy)
[ ] PostgreSQL porta 5432 não exposta publicamente
[ ] Firewall: apenas porta 80/443 aberta ao público
[ ] Liberações de firewall outbound para APIs externas (ver seção "APIs Externas")

Operação
[ ] npm run frontend:build executado com sucesso — frontend/dist/react-app.js e frontend/dist/portal-app.js existem (senão, todas as telas migradas ficam em branco)
[ ] PM2 ou systemd configurado (auto-restart)
[ ] /health retorna {"status":"ok"} após deploy
[ ] Backup automático do banco configurado
[ ] Monitoramento de logs ativo (pm2 logs / journalctl)
[ ] Monitor externo configurado (UptimeRobot ou similar) apontando para /health
[ ] Price List sincronizado (Configurações → Price List → Sincronizar)
[ ] Usuário administrador criado via wizard de setup

Assets
[ ] mascote.png copiado manualmente para a pasta raiz da aplicação
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Padrão inseguro | Descrição |
|---|---|---|---|
| `JWT_SECRET` | ✅ Prod | `finops-secret-2024` | Chave de assinatura JWT — quem tiver pode forjar tokens |
| `MASTER_KEY` | ✅ Prod | `finops-master-key-...` | Chave AES para criptografar `.finops_setup` |
| `DB_PASSWORD` | ✅ | — | Senha do PostgreSQL |
| `DB_HOST` | ✅ | `localhost` | Host do PostgreSQL |
| `DB_PORT` | — | `5432` | Porta do PostgreSQL |
| `DB_NAME` | — | `finops_db` | Nome do banco |
| `DB_USER` | — | `postgres` | Usuário do banco |
| `PORT` | — | `3000` | Porta HTTP do servidor Node |
| `ALLOWED_ORIGIN` | ✅ Prod | `null` (permite tudo) | Origin CORS — ex: `https://finops.vivo.com.br` |
| `JWT_EXPIRES` | — | `8h` | TTL do token JWT |
| `DATABASE_URL` | — | — | Connection string completa (Railway/Render/Fly) — substitui DB_* |

**Prioridade de configuração:** variáveis de ambiente do sistema → `.env.enc` + `.env.key` → `.env` → `.finops_setup` (wizard)

---

## Windows (local / on-premise)

### 1. Instalar dependências

- [Node.js 18 LTS](https://nodejs.org/en/download) — marque "Add to PATH" no instalador
- [PostgreSQL 16](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) — anote a senha do `postgres`

### 2. Configurar banco e aplicação

```powershell
# Criar banco (psql ou pgAdmin)
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;

# Na pasta do projeto
cd C:\FinOps
npm install

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build
```

### 3. Criar `.env` e iniciar

```powershell
# Gerar segredos
$jwt  = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$mkey = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

@"
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_segura
JWT_SECRET=$jwt
MASTER_KEY=$mkey
PORT=3000
ALLOWED_ORIGIN=http://localhost:3000
"@ | Set-Content .env -Encoding UTF8

npm start
```

Acesse `http://localhost:3000` — o wizard de configuração abre automaticamente na primeira execução.

### 4. Executar como serviço Windows (PM2)

```powershell
npm install -g pm2 pm2-windows-startup
pm2 start server.js --name finops-manager
pm2 save
pm2-startup install
```

---

## Linux (Ubuntu / Debian)

### 1. Instalar Node.js 18 e PostgreSQL

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-contrib

sudo systemctl enable --now postgresql
```

### 2. Criar banco e usuário

```bash
sudo -u postgres psql <<EOF
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;
EOF
```

### 3. Instalar e configurar aplicação

```bash
sudo mkdir -p /opt/finops
sudo cp -r /caminho/dos/arquivos/* /opt/finops/
sudo chown -R $USER:$USER /opt/finops
cd /opt/finops
npm install --omit=dev

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

# Gerar segredos e criar .env
JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MKEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > .env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_segura
JWT_SECRET=$JWT
MASTER_KEY=$MKEY
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

chmod 600 .env
```

### 4. PM2 ou systemd

**PM2:**
```bash
sudo npm install -g pm2
pm2 start server.js --name finops-manager
pm2 save && pm2 startup
```

**systemd:**
```bash
sudo tee /etc/systemd/system/finops.service > /dev/null <<'EOF'
[Unit]
Description=FinOps Manager v2.0
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now finops
sudo journalctl -u finops -f
```

---

## Docker

### Dockerfile

Build em dois estágios: o primeiro compila o frontend React (`frontend/`, bundle Vite — precisa do `node_modules`
completo do Vite/TypeScript, que não deve ir para a imagem final); o segundo monta a imagem de produção só com
o backend + o resultado já compilado (`frontend/dist/`). **Sem esse build, a aplicação sobe e o login funciona,
mas todas as telas migradas para React ficam em branco.**

```dockerfile
# ── Estágio 1: build do frontend React ──
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Estágio 2: imagem de produção ──
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN mkdir -p uploads_tmp
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
version: "3.9"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: finops_db
      DB_USER: finops_user
      DB_PASSWORD: ${DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      MASTER_KEY: ${MASTER_KEY}
      PORT: 3000
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: finops_db
      POSTGRES_USER: finops_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finops_user -d finops_db"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

```bash
# Criar .env com segredos reais antes de executar
docker compose up -d
docker compose logs -f app
```

> **Upload de arquivos grandes:** o multer grava temporariamente em `uploads_tmp/` e apaga após o import. Em containers, monte um volume se precisar de persistência entre restarts.

---

## Azure

### App Service + Azure Database for PostgreSQL Flexible

```bash
az login
az group create --name rg-finops --location brazilsouth

# PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-finops --name finops-pg \
  --location brazilsouth --version 16 \
  --admin-user finops_user --admin-password "SenhaSegura123!" \
  --sku-name Standard_B1ms --tier Burstable

az postgres flexible-server db create \
  --resource-group rg-finops --server-name finops-pg --database-name finops_db

# App Service
az appservice plan create --name plan-finops --resource-group rg-finops \
  --sku B1 --is-linux

az webapp create --resource-group rg-finops --plan plan-finops \
  --name finops-manager --runtime "NODE:18-lts"

# Variáveis de ambiente
az webapp config appsettings set --resource-group rg-finops --name finops-manager \
  --settings \
    DB_HOST="finops-pg.postgres.database.azure.com" \
    DB_PORT="5432" DB_NAME="finops_db" DB_USER="finops_user" \
    DB_PASSWORD="SenhaSegura123!" \
    JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
    MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
    PORT="8080" \
    ALLOWED_ORIGIN="https://finops-manager.azurewebsites.net"

# Build do frontend React ANTES de zipar (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

# Deploy via ZIP (mantém frontend/dist, exclui node_modules/src de dev)
zip -r deploy.zip . --exclude="node_modules/*" --exclude="frontend/node_modules/*" \
  --exclude="frontend/src/*" --exclude=".git/*" --exclude="uploads_tmp/*" --exclude=".env*"
az webapp deployment source config-zip \
  --resource-group rg-finops --name finops-manager --src deploy.zip
```

HTTPS automático em `https://finops-manager.azurewebsites.net`. Para domínio próprio: **Custom Domains → App Service Managed Certificate**.

---

## AWS

### EC2 + RDS PostgreSQL

```bash
# RDS
aws rds create-db-instance \
  --db-instance-identifier finops-pg \
  --db-instance-class db.t3.micro --engine postgres --engine-version 16 \
  --master-username finops_user --master-user-password "SenhaSegura123!" \
  --allocated-storage 20 --db-name finops_db --no-publicly-accessible

# EC2 (Amazon Linux 2023)
sudo dnf install -y nodejs20 npm
sudo npm install -g pm2
mkdir /home/ec2-user/finops && cd /home/ec2-user/finops
npm install --omit=dev

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MKEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
cat > .env <<EOF
DB_HOST=finops-pg.xxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432 DB_NAME=finops_db DB_USER=finops_user DB_PASSWORD=SenhaSegura123!
JWT_SECRET=$JWT MASTER_KEY=$MKEY PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

pm2 start server.js --name finops-manager && pm2 startup && pm2 save
```

**Recomendado:** usar AWS Secrets Manager para `JWT_SECRET`, `MASTER_KEY` e `DB_PASSWORD` em vez de `.env` no servidor.

---

## GCP

### Cloud Run + Cloud SQL

```bash
gcloud sql instances create finops-pg \
  --database-version=POSTGRES_16 --tier=db-f1-micro --region=southamerica-east1
gcloud sql databases create finops_db --instance=finops-pg
gcloud sql users create finops_user --instance=finops-pg --password=SenhaSegura123!

# Secrets
echo -n "<jwt>" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "<mkey>" | gcloud secrets create MASTER_KEY --data-file=-

gcloud builds submit --tag gcr.io/SEU_PROJETO/finops-manager
# usa o Dockerfile do repositório (seção Docker acima) — já builda o frontend React
# em estágio separado, então nenhum passo extra é necessário aqui.

gcloud run deploy finops-manager \
  --image gcr.io/SEU_PROJETO/finops-manager \
  --region southamerica-east1 --allow-unauthenticated \
  --add-cloudsql-instances SEU_PROJETO:southamerica-east1:finops-pg \
  --set-env-vars DB_HOST="/cloudsql/SEU_PROJETO:southamerica-east1:finops-pg",\
    DB_NAME=finops_db,DB_USER=finops_user,PORT=8080,\
    ALLOWED_ORIGIN=https://finops-manager-xxx.run.app \
  --set-secrets DB_PASSWORD=DB_PASSWORD:latest,JWT_SECRET=JWT_SECRET:latest,\
    MASTER_KEY=MASTER_KEY:latest \
  --memory 512Mi --min-instances 0 --max-instances 5
```

---

## Cloud Deployment (v4.0.0)

### Railway

```bash
npm install -g @railway/cli
railway login && railway init
railway add --plugin postgresql   # DATABASE_URL injetado automaticamente
railway up
```

**Environment Variables** no painel Railway:
- `JWT_SECRET` — gerado via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `MASTER_KEY` — gerado via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ALLOWED_ORIGIN` — seu domínio de produção (ex: `https://seu-dominio.com`)
- Opcionais: `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET` (para Coleta Azure)
- Opcionais: `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` (para Coleta Databricks)
- Opcionais: `SMTP_*` (para alertas por e-mail)

⚠️ **Build do frontend** — Railway usa Nixpacks e por padrão só roda `npm install`. As telas migradas (Dashboard, Projetos, Estimativas) ficam em branco sem o build React. **No painel Railway:**
- Settings → Build → Build Command: `npm install && npm run frontend:build`

### Render

1. **New → Web Service** → conectar repositório Git
2. **Build Command**: `npm install && npm run frontend:build`
3. **Start Command**: `node server.js`
4. **Environment**: adicionar variáveis (ver lista Railway acima)
5. **New → PostgreSQL** → `DATABASE_URL` será injetado automaticamente

### Fly.io

```bash
fly launch --name finops-manager --region gru
fly postgres create --name finops-pg --region gru
fly postgres attach finops-pg

# Gerar secrets criptograficamente seguros
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

fly secrets set \
  JWT_SECRET="$JWT_SECRET" \
  MASTER_KEY="$MASTER_KEY" \
  ALLOWED_ORIGIN=https://finops-manager.fly.dev

fly deploy
```

✅ Fly.io usa o Dockerfile do repositório, que já builda o frontend React no primeiro estágio — nenhum passo extra necessário.

### Azure App Service + PostgreSQL Flexible Server

Deploy em PaaS nativo do Azure:

```bash
# Criar grupo de recursos
az group create --name rg-finops --location brazilsouth

# PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-finops \
  --name finops-pg \
  --location brazilsouth \
  --version 16 \
  --admin-user pgadmin \
  --admin-password '<senha-forte>' \
  --sku-name Standard_B1ms \
  --tier Burstable

# Database
az postgres flexible-server db create \
  --resource-group rg-finops \
  --server-name finops-pg \
  --database-name finops_db

# App Service Plan
az appservice plan create \
  --resource-group rg-finops \
  --name finops-plan \
  --sku B1 \
  --is-linux

# Web App
az webapp create \
  --resource-group rg-finops \
  --plan finops-plan \
  --name finops-manager \
  --runtime 'NODE:18-lts'

# Configurar startup
az webapp config set \
  --resource-group rg-finops \
  --name finops-manager \
  --startup-file 'node server.js'

# Build command do frontend (obrigatório!)
az webapp config appsettings set \
  --resource-group rg-finops \
  --name finops-manager \
  --settings \
  PRE_BUILD_COMMAND='npm install && npm run frontend:build'

# Variáveis de ambiente (secrets)
az webapp config appsettings set \
  --resource-group rg-finops \
  --name finops-manager \
  --settings \
  DATABASE_URL='postgresql://pgadmin:<senha>@finops-pg.postgres.database.azure.com:5432/finops_db?sslmode=require' \
  JWT_SECRET='<gerado-randomicamente>' \
  MASTER_KEY='<gerado-randomicamente>' \
  ALLOWED_ORIGIN='https://finops-manager.azurewebsites.net' \
  NODE_ENV='production' \
  TZ='America/Sao_Paulo'

# Deploy via Git (configure repositório Git local)
az webapp deployment user set --user-name <seu-usuario> --password <sua-senha>
git remote add azure https://<seu-usuario>@finops-manager.scm.azurewebsites.net:443/finops-manager.git
git push azure main
```

✅ App Service injeta `DATABASE_URL` automaticamente do PostgreSQL Flexible Server. O frontend é buildado via `PRE_BUILD_COMMAND`.

---

## SSL / Proxy reverso

### Nginx + Certbot (Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/finops > /dev/null <<'EOF'
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 600M;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/finops /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seu-dominio.com
```

---

## Segurança em produção

### Criptografar `.env`

```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key
rm .env                       # apaga texto plano
# Guarda .env.key fora do servidor (Key Vault, Secrets Manager, cofre)
node encrypt-env.js run       # inicia com env criptografado
```

### Vulnerabilidades conhecidas (npm audit)

| Pacote | Severidade | Status | Mitigação |
|---|---|---|---|
| `thrift` (via `@dsnp/parquetjs`) | 🔴 High | Sem fix disponível | Import Parquet requer autenticação; arquivo deletado após uso |
| `uuid` (via `exceljs ≥3.5`) | 🟡 Moderate | Fix = downgrade exceljs (breaking) | Risco baixo — uso interno para gerar IDs em exports |

Execute `npm audit` periodicamente e aplique `npm audit fix` quando disponível.

### Headers de segurança (configurados automaticamente)

O servidor usa `helmet` com CSP desabilitado (para compatibilidade com o SPA inline):

- `X-Frame-Options` — DENY (sem iframes)
- `X-Content-Type-Options` — nosniff
- `Referrer-Policy` — strict-origin-when-cross-origin
- `X-DNS-Prefetch-Control` — off
- `X-Download-Options` — noopen

> **HSTS (Strict-Transport-Security):** não é configurado pelo Node — deve ser adicionado no proxy reverso (Nginx/Caddy). Exemplo para Nginx: `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`

### Arquivos que NÃO são acessíveis via HTTP (v2.0)

`server.js` · `package.json` · `.env` · `.env.key` · `.env.enc` · `.finops_setup` · `*.sql`

**Arquivos servidos estaticamente:** `index.html` · `app.js` · `calculadora.js` · `styles.css` · `favicon.svg` · `mascote.png` · `fonts/*.woff2` · `libs/xlsx.full.min.js`

### Atualizar as fontes tipográficas

As fontes IBM Plex são open-source (SIL OFL 1.1) e distribuídas via [`@fontsource`](https://fontsource.org). Para atualizar para uma versão mais nova:

```bash
# 1. Instalar pacotes fontsource temporariamente
npm install --save-dev @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono

# 2. Copiar apenas os subsets latin e latin-ext que o sistema usa
# Linux / macOS
BASE_SANS="node_modules/@fontsource/ibm-plex-sans/files"
BASE_MONO="node_modules/@fontsource/ibm-plex-mono/files"

for w in 300 400 500 600 700; do
  cp "$BASE_SANS/ibm-plex-sans-latin-${w}-normal.woff2"     "fonts/ibm-plex-sans-latin-${w}.woff2"
  cp "$BASE_SANS/ibm-plex-sans-latin-ext-${w}-normal.woff2" "fonts/ibm-plex-sans-latin-ext-${w}.woff2"
done
for w in 400 500 600; do
  cp "$BASE_MONO/ibm-plex-mono-latin-${w}-normal.woff2"     "fonts/ibm-plex-mono-latin-${w}.woff2"
  cp "$BASE_MONO/ibm-plex-mono-latin-ext-${w}-normal.woff2" "fonts/ibm-plex-mono-latin-ext-${w}.woff2"
done
```

```powershell
# Windows (PowerShell)
$baseSans = "node_modules\@fontsource\ibm-plex-sans\files"
$baseMono = "node_modules\@fontsource\ibm-plex-mono\files"

foreach ($w in @(300,400,500,600,700)) {
  Copy-Item "$baseSans\ibm-plex-sans-latin-$w-normal.woff2"     "fonts\ibm-plex-sans-latin-$w.woff2"
  Copy-Item "$baseSans\ibm-plex-sans-latin-ext-$w-normal.woff2" "fonts\ibm-plex-sans-latin-ext-$w.woff2"
}
foreach ($w in @(400,500,600)) {
  Copy-Item "$baseMono\ibm-plex-mono-latin-$w-normal.woff2"     "fonts\ibm-plex-mono-latin-$w.woff2"
  Copy-Item "$baseMono\ibm-plex-mono-latin-ext-$w-normal.woff2" "fonts\ibm-plex-mono-latin-ext-$w.woff2"
}
```

```bash
# 3. Remover pacotes temporários
npm uninstall @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono

# 4. Commitar os novos arquivos
git add fonts/
git commit -m "chore: atualizar IBM Plex fonts para versao X.X"
```

> Os `@font-face` em `styles.css` não precisam ser alterados — os nomes dos arquivos são estáveis entre versões do fontsource.

### Atualizar o XLSX.js

O arquivo `libs/xlsx.full.min.js` é a versão `0.18.5` da biblioteca SheetJS Community Edition (última versão open-source gratuita). Para atualizar:

```bash
# Linux / macOS
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" \
  -o libs/xlsx.full.min.js

git add libs/xlsx.full.min.js
git commit -m "chore: atualizar xlsx.js para versao X.X.X"
```

```powershell
# Windows (PowerShell)
Invoke-WebRequest "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" `
  -OutFile "libs\xlsx.full.min.js"

git add libs/xlsx.full.min.js
git commit -m "chore: atualizar xlsx.js para versao X.X.X"
```

> **Atenção:** versões acima de `0.18.5` são comerciais (SheetJS Pro). Verifique a licença antes de atualizar. A versão `0.18.5` é suficiente para leitura de `.xlsx`/`.xls` e não tem planos de descontinuação.

---

## Production Checklist

Antes de implantar em produção:

- [ ] `JWT_SECRET` definido com string aleatória (≥ 32 chars)
  - Gerar com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - Máxima segurança: qualquer um com este valor pode forjar tokens de login
- [ ] `MASTER_KEY` definido com string aleatória (≥ 32 chars)
  - Gerar com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - Aviso: se mudar após setup, arquivo `.finops_setup` torna-se ilegível — guardar em cofre seguro
- [ ] `DB_PASSWORD` configurado e diferente do padrão
- [ ] `ALLOWED_ORIGIN` ajustado para o domínio exato de produção
- [ ] `.env` criptografado (`node encrypt-env.js encrypt`) — `.env.key` armazenado seguramente fora do servidor
- [ ] `uploads_tmp/` com permissões de escrita para o processo Node
- [ ] PostgreSQL 13+ instalado, banco e usuário criados com permissões mínimas
- [ ] PostgreSQL acessível desde o host do Node no `DB_HOST:DB_PORT` configurado
- [ ] `mascote.png` presente no diretório da aplicação (não rastreado pelo git — copiar manualmente)
- [ ] Reverse proxy (Nginx/Caddy) configurado com HTTPS (Let's Encrypt Certbot) e headers de segurança (HSTS, CSP)
- [ ] PM2 ou systemd configurado para auto-restart em crash/reboot
- [ ] Frontend React buildado: `npm install && npm run frontend:build` concluído com sucesso
- [ ] Node rodando com `NODE_ENV=production` (desabilita verbose logging)
- [ ] Firewall corporativo liberado para outbound: Azure APIs, SMTP (se alertas habilitados), LDAP/Entra ID (se auth externa)
- [ ] Se **Portal Público** ativado: `PORTAL_SUBSCRIPTION_IDS` configurado — sem isso, nenhum dado é exposto
- [ ] Se **Portal Público** ativado: `PORTAL_SOLICITAR_IDENTIFICACAO=true` ou `PORTAL_DOMINIOS_ACEITOS` configurado para restringir acesso
- [ ] Se **Coleta Azure** ativada: Azure Service Principal credenciado em `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`
- [ ] Se **Coleta Databricks** ativada: OAuth M2M ou PAT configurado em `DATABRICKS_*` variables
- [ ] Se **Alertas SMTP** ativados: servidor SMTP testado (`POST /api/integrations/smtp/testar`)
- [ ] Se **SSO Entra ID** ativado: aplicação registrada no Azure AD e `ENTRA_*` configurado

---

## Atualizar uma instalação em produção

Depois do primeiro deploy, aplicar uma atualização (nova branch/commit) é um processo diferente do
setup inicial — não repete o wizard, só atualiza o código e reinicia o processo.

```bash
cd /caminho/da/instalacao
git pull origin main

npm install                  # só se package.json mudou
npm run frontend:build       # SEMPRE — telas React ficam em branco sem isso

# PM2
pm2 restart finops-manager

# systemd (alternativa)
sudo systemctl restart finops
```

- [ ] `git pull` sem conflitos
- [ ] `npm run frontend:build` concluído sem erro
- [ ] Processo reiniciado (PM2/systemd)
- [ ] `/health` retorna `{"status":"ok"}` depois do restart
- [ ] Testar a tela/feature que motivou a atualização antes de considerar concluído

> **Migrações de banco são automáticas:** todo `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` roda no startup do `server.js` — não é preciso rodar nenhum script SQL manual (ver seção **Database** em `MODULES/06-DATABASE.md`).

---

## APIs Externas — Liberação de Firewall

O sistema realiza chamadas externas tanto a partir do **servidor Node.js** quanto a partir do **navegador do usuário**. Ambas as direções precisam ser liberadas na infraestrutura de rede.

### Servidor → Internet (Outbound do servidor)

| Serviço | URL / Destino | Porta | Protocolo | Quando é usado |
|---|---|---|---|---|
| **Azure Retail Prices** | `https://prices.azure.com` | 443 | HTTPS | Sincronização do Price List (Configurações → Price List → Sincronizar) |
| **Azure Management API** | `https://management.azure.com` | 443 | HTTPS | Coleta Automática de custos (lista subscriptions, RGs e aciona export) |
| **Microsoft Entra ID (login)** | `https://login.microsoftonline.com` | 443 | HTTPS | Autenticação SSO OAuth 2.0 (se Entra ID estiver configurado) |
| **Azure Storage (Blobs)** | `https://*.blob.core.windows.net` | 443 | HTTPS | Download dos arquivos de export gerados pela Coleta Automática |
| **Active Directory / LDAP** | Servidor AD corporativo | 389 (LDAP) / 636 (LDAPS) | TCP | Autenticação via Active Directory (se AD estiver configurado) |

> **LDAPS (porta 636) é fortemente recomendado em produção.** Usar LDAP simples (389) transmite credenciais sem criptografia.

### Navegador → Internet (Outbound do browser do usuário)

**Nenhuma chamada externa necessária.** Todas as bibliotecas e fontes são self-hosted:

| Asset | Local | Observação |
|---|---|---|
| IBM Plex Sans / Mono | `fonts/*.woff2` | Self-hosted — sem Google Fonts |
| XLSX.js 0.18.5 | `libs/xlsx.full.min.js` | Self-hosted — sem cdnjs/Cloudflare |

> O browser do usuário **não faz nenhuma request para domínios externos**. Zero regras de firewall outbound necessárias para o frontend.

### Resumo de portas e direções

```
SERVIDOR (outbound)
  443/TCP  → prices.azure.com
  443/TCP  → management.azure.com
  443/TCP  → login.microsoftonline.com
  443/TCP  → *.blob.core.windows.net
  389/TCP  → [AD server]    ← LDAP simples (evitar em prod)
  636/TCP  → [AD server]    ← LDAPS (recomendado)

NAVEGADOR (outbound)
  (sem saída externa — fontes e xlsx.js são self-hosted)

INBOUND (para o servidor Node.js)
  3000/TCP ← apenas do proxy reverso (Nginx/Caddy) — nunca expor ao público
  80/TCP   ← público (redireciona para HTTPS via Nginx)
  443/TCP  ← público (terminado no Nginx, encaminhado para :3000)
  5432/TCP ← apenas da aplicação Node.js (PostgreSQL — nunca expor ao público)
```

### Observações para ambientes com saída restrita

- **Price List:** se `prices.azure.com` estiver bloqueado, a sincronização falha silenciosamente e a calculadora usa apenas o custo histórico de billing (sem coluna PL/h e sem badges de desconto).
- **Coleta Automática:** requer acesso a `management.azure.com` e ao `*.blob.core.windows.net` da subscription configurada. Sem acesso, a coleta falha e registra erro no histórico.
- **SSO Entra ID:** sem acesso a `login.microsoftonline.com`, o botão "Entrar com Microsoft" não funciona. O login local (e-mail + senha) e o AD continuam funcionando.
- **Fontes e XLSX.js:** 100% self-hosted (`fonts/` e `libs/`) — sem dependência externa no browser. Nenhuma regra de firewall necessária para o frontend.

---

## API Endpoints

Todos os endpoints (exceto `/health`, `/api/auth/*` e `/api/setup/*`) exigem:
```
Authorization: Bearer <jwt_token>
```

### Sistema

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | ❌ | Status do servidor e banco — para monitoramento |
| GET | `/api/usuarios` | ✅ admin | Listar usuários |
| POST | `/api/usuarios` | ✅ admin | Criar usuário |

### Autenticação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login local (email + senha) — rate limit 20/15min |
| POST | `/api/auth/ad` | Login Active Directory (LDAP) — rate limit 20/15min |
| GET | `/api/auth/entra/redirect` | Inicia OAuth Microsoft Entra ID |
| GET | `/api/auth/entra/callback` | Callback OAuth Entra ID |

### Projetos e Ações FinOps

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/projetos` | Listar projetos |
| POST | `/api/projetos` | Criar projeto |
| PUT | `/api/projetos/:id` | Atualizar projeto |
| DELETE | `/api/projetos/:id` | Excluir projeto |
| GET | `/api/acoes` | Listar ações (filtros: `projeto_id`, `status`, `cloud`) |
| POST | `/api/acoes` | Criar ação |
| PUT | `/api/acoes/:id` | Atualizar ação |
| DELETE | `/api/acoes/:id` | Excluir ação |

### Dashboard e Export

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dashboard` | Estatísticas agregadas por status e cloud |
| GET | `/api/export/excel` | Download `.xlsx` — Sumário / Ações / Retorno Mensal |

### Calculadora Azure

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/calculadora/subscriptions` | Subscriptions (cache — < 5 ms) |
| GET | `/api/calculadora/resource-groups` | Resource Groups por subscription (cache) |
| GET | `/api/calculadora/recursos` | Recursos com custo/h, Price List e desconto |
| POST | `/api/calculadora/estimar` | Estimativa consolidada por período |
| GET | `/api/calculadora/reconciliacao` | Reconciliação por subscription/RG/período |

### Custos Azure (Import)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/azure-costs/import` | Upload CSV, Parquet ou ZIP — aceita até 500 MB |
| GET | `/api/azure-costs/import-status` | Status do import em andamento |

### Azure Retail Price List *(novo v2.0)*

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/price-list/status` | Total de registros, data da última sync e status |
| POST | `/api/price-list/sync` | Inicia sincronização com `prices.azure.com` (fire-and-forget) |

### Reservas Cloud *(novo v2.0)*

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/reservas` | Listar reservas (filtros: `cloud`, `status`) |
| POST | `/api/reservas` | Criar reserva |
| PUT | `/api/reservas/:id` | Atualizar reserva |
| DELETE | `/api/reservas/:id` | Excluir reserva |

### Coleta Azure — multi-SP *(novo v4.2)*

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/azure-coleta/status` | Estado da coleta. Campos legados (`em_execucao`, `progresso`, `cancelando`) + array novo `execucoes[]` com uma entrada por execução ativa (`{tipo, id, nome, iniciado_em, cancelando, progresso}`) |
| POST | `/api/azure-coleta/cancelar` | Corpo opcional `{ tipo, id }` cancela só aquela execução (ex. `{tipo:'api', id:7}`); sem corpo, cancela todas as ativas |
| POST | `/api/azure-coleta/sps/:id/coletar-api` | Dispara coleta manual daquela SP — não bloqueia mais se outra SP estiver coletando |
| GET | `/api/azure-coleta/coletar-todas/preview` | Plano do "Coletar Todas" sem executar: SPs aptas (modo, período, nº de assinaturas) e inaptas com o motivo. Aceita `data_inicio`/`data_fim` pra simular período customizado |
| POST | `/api/azure-coleta/coletar-todas` | Dispara coleta em **todas** as SPs ativas em paralelo. Sem `data_inicio`/`data_fim`, cada SP usa a própria janela de granularidade (igual ao agendador). **Não** altera `proxima_coleta` — é execução manual, não desloca o agendamento |
| POST | `/api/azure-coleta/storages/:id/executar` | Idem para coleta via Storage Account |
| GET | `/api/azure-coleta/diag-agendador` | Diagnóstico: quais configs estão `due` e por quê |

### Log Analytics FinOps *(expandido v4.2)*

Filtros de query aceitos pelas rotas de leitura: `mes=YYYY-MM`, `sp_id=<id>` (Service Principal) e
`workspace_guid` — este último aceita **múltiplos** valores, separados por vírgula ou repetindo o
parâmetro (`?workspace_guid=a,b` ou `?workspace_guid=a&workspace_guid=b`).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/log-analytics/resumo` | Payload principal da tela: workspaces, cards de volume, Sentinel, Commitment Tier e sugestão de nível |
| GET | `/api/log-analytics/workspaces` | Inventário de workspaces (retenção, plano, SKU) |
| GET | `/api/log-analytics/workspaces/:guid/tabelas` | Tabelas com GB, custo real e comparativo Analytics × Basic por GB |
| GET | `/api/log-analytics/workspaces/:guid/ingestao` | Série diária de ingestão do workspace |
| GET | `/api/log-analytics/workspaces/:guid/consumo-diario` | Consumo diário consolidado |
| GET | `/api/log-analytics/workspaces/:guid/recursos-volume` | Ranking de recursos por volume gerado, com o caminho de entrada do dado |
| GET | `/api/log-analytics/workspaces/:guid/fontes` | Fontes de ingestão identificadas |
| GET | `/api/log-analytics/workspaces/:guid/diagnostic-settings` | Diagnostic Settings do workspace, com detecção de fan-out |
| GET | `/api/log-analytics/custo-observabilidade` | Gasto de observabilidade por balde; respeita o recorte de workspace e preserva o gasto sem workspace |
| GET | `/api/log-analytics/export-sem-workspace` | Export de log que paga e não alimenta workspace nenhum |
| GET | `/api/log-analytics/app-insights` | Inventário de Application Insights (sampling, daily cap, retenção) |
| GET | `/api/log-analytics/recomendacoes` | Recomendações consolidadas (downgrade pra Basic, retenção, fan-out) |
| GET | `/api/log-analytics/export/excel` | Export Excel da análise |
| GET | `/api/log-analytics/export/dashboard` | Dashboard HTML autocontido |
| GET | `/api/log-analytics/progresso` | Andamento das coletas em curso (fase, atual/total, item atual, erro) — barato, feito pra poll de 2s |
| POST | `/api/log-analytics/coleta/forcar` | Força coleta do inventário de Log Analytics (janela fixa de 30 dias) |
| POST | `/api/log-analytics/backfill-volume` | Backfill de volume por período — `{ dias }` de 1 a 365, limitado pela retenção real de cada workspace |
| POST | `/api/log-analytics/backfill-atribuicao` | Backfill de "quem gerou os GB" por período — `{ dias }`, limitado pela retenção real de **cada tabela** |
| POST | `/api/log-analytics/ingestao-recurso/forcar` | Força a coleta de ingestão por recurso (janela fixa de 3 dias) |
| POST | `/api/log-analytics/diagnostic-settings/forcar` | Força a coleta de Diagnostic Settings |
| POST | `/api/log-analytics/workspaces/:guid/auditoria-consultas/habilitar` | Habilita `LAQueryLogs` (⚠️ escreve na Azure) |
| POST | `/api/log-analytics/workspaces/:guid/tabelas/:tabela/detalhar-recurso` | Lista os recursos que alimentam uma tabela |

### Mailing de Comunicados

Relay próprio, **separado do SMTP de Alertas** — ver "Onde ficam os segredos".

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/api/mailing/contatos` | Listar / criar contato (cadastro único por e-mail) |
| PATCH/DELETE | `/api/mailing/contatos/:id` | Atualizar / excluir contato |
| POST | `/api/mailing/contatos/import` | Importação em massa de Excel/CSV |
| GET | `/api/mailing/import-lotes` | Relatório dos lotes importados |
| GET/POST | `/api/mailing/campanhas` | Listar / criar campanha |
| GET/PUT/DELETE | `/api/mailing/campanhas/:id` | Ler / atualizar / excluir campanha |
| POST | `/api/mailing/campanhas/:id/enviar-teste` | Envio de teste para um endereço |
| POST | `/api/mailing/campanhas/:id/enviar` | Dispara o envio (snapshot dos contatos ativos) |
| POST | `/api/mailing/campanhas/:id/reenviar-falhas` | Reprocessa só os destinatários que falharam |
| POST | `/api/mailing/campanhas/:id/cancelar` | Cancela o envio em andamento (efetivo entre lotes) |
| GET | `/api/mailing/campanhas/:id/progresso` | Progresso do envio |
| GET | `/api/mailing/campanhas/:id/envios` | Status por destinatário |
| GET/POST/DELETE | `/api/mailing/templates` | Biblioteca de modelos |
| POST | `/api/mailing/upload-imagem` | Upload de imagem para o corpo do comunicado |
| POST | `/api/mailing/relay/testar` | Testa o relay (admin) — sem senha, autorizado por IP |
| GET | `/api/public/mailing/descadastro` | ❌ Descadastro público, token HMAC autoverificável |

### Economia realizada (órfãos excluídos)

O resumo vem embutido em `GET /api/azure-inventario/desperdicio` (campo `saving`) e, só com os
totais, em `GET /api/public/orfaos`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/azure-inventario/saving/ignorar` | Marca/desmarca um item como "não é economia nossa". `resource_id` no corpo (é caminho com barras); motivo obrigatório para marcar; autor vem do token |
