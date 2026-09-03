// Contrato de server.js — Inventário + Auditoria de Recursos Azure (2026-08-30, pedido do
// usuário: "ontem tinha X recursos, hoje tenho X+1 — quem criou, quando, quanto custa").
// Fonte: Azure Activity Log. Ver seção "INVENTÁRIO + AUDITORIA DE RECURSOS AZURE" em
// server.js.

export interface AzureInventarioConfig {
  id: number
  ativo: boolean
  retencao_dias: number
  sp_id: number | null
  subscription_ids: string | null
  ultimo_evento_em: string | null
  // Chaves de tag obrigatórias, separadas por vírgula (ex: "projeto,centro_custo") — checadas
  // contra azure_costs.tags (ver GET /azure-inventario/tags-faltantes). null/vazio = checagem desativada.
  tags_obrigatorias: string | null
  criado_em: string
  atualizado_em: string
}

export interface AzureInventarioConfigInput {
  ativo: boolean
  retencao_dias: number
  sp_id: number | null
  subscription_ids: string | null
  tags_obrigatorias: string | null
}

// Governança de crescimento (2026-08-31, pedido do usuário: "quais melhorias vc me sugere
// para poder ter o controle de crescimento de recursos na cloud") — ver seção "Inventário —
// Governança de crescimento" em server.js.

export type AzureAnomaliaCrescimentoEscopo = 'subscription' | 'resource_group'
export type AzureAnomaliaCrescimentoGatilho = 'criacoes' | 'custo' | 'ambos'
// Combina 2 sinais no mesmo dia/escopo (2026-08-31, pedido do usuário: "anomalias de
// Crescimento com base a mudança e Dinheiro") — quantidade de recursos criados E custo (R$),
// cada um com seu próprio Z-score sobre a mesma janela de 35 dias. `gatilho` indica qual
// sinal (ou os dois) cruzou o threshold pra aquela linha aparecer na lista.
export interface AzureAnomaliaCrescimento {
  escopo_tipo: AzureAnomaliaCrescimentoEscopo
  subscription_id: string
  resource_group: string | null
  dia: string
  criacoes: number
  custo: number
  media_criacoes: number
  desvio_criacoes: number
  media_custo: number
  desvio_custo: number
  zscore_criacoes: number
  zscore_custo: number
  gatilho: AzureAnomaliaCrescimentoGatilho
}

export type AzureOrcamentoEscopoTipo = 'subscription' | 'resource_group'
export type AzureOrcamentoTipoLimite = 'recursos' | 'custo'

export interface AzureOrcamentoInventario {
  id: number
  nome: string
  escopo_tipo: AzureOrcamentoEscopoTipo
  subscription_id: string
  resource_group: string | null
  tipo_limite: AzureOrcamentoTipoLimite
  limite_valor: number
  threshold_atencao: number
  threshold_critico: number
  ativo: boolean
  criado_em: string
  atualizado_em: string
}
export interface AzureOrcamentoInventarioInput {
  nome: string
  escopo_tipo: AzureOrcamentoEscopoTipo
  subscription_id: string
  resource_group: string | null
  tipo_limite: AzureOrcamentoTipoLimite
  limite_valor: number
  threshold_atencao: number
  threshold_critico: number
  ativo: boolean
}
export type AzureOrcamentoSeveridade = 'atencao' | 'critico' | 'estourado'
export interface AzureOrcamentoAlerta {
  orcamento: AzureOrcamentoInventario
  valor_atual: number
  pct: number
  severidade: AzureOrcamentoSeveridade
}

export interface AzureTagsFaltantesRecurso {
  subscription_id: string
  resource_id: string
  nome: string | null
  resource_group: string | null
  resource_type: string | null
  tags_faltando: string[]
}
export interface AzureTagsFaltantesResposta {
  chaves: string[]
  nao_conformes: AzureTagsFaltantesRecurso[]
  nao_verificaveis: number
  total_verificado: number
}

export interface AzureInventarioStatus {
  em_execucao: boolean
  iniciada_em: string | null
  progresso: {
    // 'coleta' (Activity Log, padrão) | 'reconciliacao' (Resource Graph, ver
    // POST /azure-inventario/reconciliar) — mesmo estado/monitor pras duas, só o rótulo muda.
    tipo?: 'coleta' | 'reconciliacao'
    fase: string
    sub_atual: string
    sub_idx: number
    sub_total: number
    eventos: number
    novos: number
    atualizados: number
    excluidos: number
    log: { ts: string; msg: string }[]
  }
}

export interface AzureInventarioColetaHistoricoItem {
  id: number
  iniciado_em: string
  concluido_em: string | null
  status: string
  origem: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  eventos_processados: number
  recursos_novos: number
  recursos_atualizados: number
  recursos_excluidos: number
  mensagem: string | null
}

// Permanente — nunca afetado pela retenção configurável (só o log de auditoria é).
export interface AzureRecursoInventario {
  id: number
  subscription_id: string
  resource_id: string
  resource_type: string | null
  resource_group: string | null
  nome: string | null
  criado_por: string | null
  criado_em: string | null
  atualizado_por: string | null
  atualizado_em: string | null
  excluido_por: string | null
  excluido_em: string | null
  ativo: boolean
  detectado_em: string
  custo_acumulado: number
  // Custo de todo o Resource Group (fallback) — ver AzureRecursoDetalheResposta.custo_resource_group,
  // mesmo conceito, só que pré-computado em lote pra lista inteira (não 1 query por linha).
  custo_resource_group: number
  // Nome resolvido via Microsoft Graph (azure_autores_cache) — `criado_por`/`atualizado_por`/
  // `excluido_por` do Activity Log quase sempre trazem um Object ID puro (GUID), não um nome
  // amigável. null enquanto não resolvido (ou sem permissão Directory.Read.All concedida) —
  // frontend cai pro GUID cru nesse caso.
  criado_por_nome: string | null
  atualizado_por_nome: string | null
  excluido_por_nome: string | null
  // 'activity_log' (padrão, tem criado_por/criado_em) | 'resource_graph' (backfill de
  // reconciliação — recurso existe mas nunca gerou evento desde a ativação do Inventário,
  // por isso sem histórico de criação). Ver server.js, _reconciliarInventarioResourceGraph.
  origem_deteccao?: 'activity_log' | 'resource_graph'
}

export type AzureAuditoriaAcao = 'CRIACAO' | 'ATUALIZACAO' | 'EXCLUSAO'

// Log bruto — sujeito ao período de retenção configurável.
export interface AzureAuditoriaEvento {
  id: number
  subscription_id: string
  resource_id: string
  resource_type: string | null
  resource_group: string | null
  acao: AzureAuditoriaAcao
  autor: string | null
  quando: string
  operation_name: string | null
  correlation_id: string | null
  criado_em: string
  // Nome amigável do recurso (join com azure_recursos_inventario.nome) — null se o recurso
  // ainda não estiver no inventário (raro — mesma coleta grava as duas tabelas juntas).
  nome: string | null
  // Nome do autor resolvido via Microsoft Graph (azure_autores_cache) — ver AzureRecursoInventario.
  autor_nome: string | null
}

// Mudança de SKU de VM (2026-09-02, pedido do usuário: "a VM tinha um SKU e mudou pra outro,
// qual o antigo e qual o novo") — gravado por `_detectarMudancasSku` (server.js) quando o
// tamanho lido via Resource Graph diverge do último valor conhecido. Só VMs nesta v1
// (`Microsoft.Compute/virtualMachines`), excluindo RGs gerenciados por Databricks/AKS (VMs
// efêmeras de cluster — "SKU mudou" ali é ruído de recriação, não um resize real).
export interface AzureSkuMudanca {
  id: number
  subscription_id: string
  resource_id: string
  resource_type: string | null
  resource_group: string | null
  sku_anterior: string | null
  sku_novo: string | null
  detectado_em: string
  evento_autor: string | null
  evento_quando: string | null
  nome: string | null
  evento_autor_nome: string | null
}

// Comparativo dia-a-dia (2026-09-02, pedido do usuário: "auditoria rode uma vez por dia e faça
// um comparativo do dia anterior") — mesmo cálculo do relatório diário por e-mail
// (`_computeRelatorioDiarioInventario`, server.js), exposto sob demanda pro card da aba
// Auditoria. Exclui RGs gerenciados por Databricks/AKS (mesmo motivo do e-mail: sem isso a
// contagem é dominada por churn de cluster efêmero).
export interface AzureRelatorioDiario {
  dia: string
  dia_anterior: string
  criados: number
  atualizados: number
  excluidos: number
  criados_dia_anterior: number
  delta: number
  top_resource_groups: { resource_group: string; criacoes: number }[]
}

// Caixas "por Tipo de Recurso" (2026-08-31, pedido do usuário: "Na parte de Auditoria pode
// incluir caixas por Tipo de Recurso, Ex VM x Disco x etc") — agregação server-side sobre
// TODO o período/filtros selecionados (não só os 300 eventos retornados pra tabela), serve
// tanto de resumo visual quanto de chip-bar clicável pra filtrar a tabela abaixo.
export interface AzureAuditoriaPorTipo {
  tipo: string
  total: number
}

// Crescimento — contagem diária de resource_id distintos, derivada de azure_costs (zero
// coleta nova) — funciona mesmo sem o Inventário/Auditoria configurado.
// Removido da UI (2026-08-31, "não está fazendo sentido") — sem nenhum chamador hoje, ver
// AzureCrescimentoLiquidoDia abaixo pro gráfico que voltou a fazer sentido (2026-09-02).
export interface AzureCrescimentoDia {
  cost_date: string
  recursos: number
}

// Crescimento LÍQUIDO (2026-09-02, pedido do usuário: "a ideia é ver crescimento de recurso
// novos, que cresça e não morra") — diferente do AzureCrescimentoDia acima (billing, conta
// QUALQUER resource_id cobrado no dia, dominado por churn de cluster): baseado em
// `azure_recursos_inventario` (permanente), conta quantos recursos estavam ativos NAQUELE
// dia, EXCLUINDO Resource Groups gerenciados por Databricks/AKS. Ver GET
// /azure-inventario/crescimento-liquido.
export interface AzureCrescimentoLiquidoDia {
  dia: string
  ativos: number
}

// Comparativo entre dois períodos — total_recursos é um SNAPSHOT (quantos recursos
// estavam ativos no FIM daquele período), não uma soma. criados/atualizados/excluidos são
// contagens de eventos DENTRO do período (ver GET /comparativo, server.js).
export interface AzureComparativoPeriodo {
  inicio: string
  fim: string
  total_recursos: number
  custo_total: number
  criados: number
  atualizados: number
  excluidos: number
}
export interface AzureComparativoResposta {
  periodo_a: AzureComparativoPeriodo
  periodo_b: AzureComparativoPeriodo
}

// Detalhe de um recurso — timeline completa de eventos + tendência de custo (últimos 90
// dias). Aberto ao clicar num recurso na aba Recursos (ou num item de um período no
// Comparativo).
// Hierarquia Assinatura → Resource Group (2026-08-31, pedido do usuário: "algo por
// Assinatura... vou fazendo drill down dos dados até chegar no recurso"). Sem `nivel`
// diferenciado por union — `subscription_id`/`resource_group` vêm um ou outro conforme o
// nível pedido (ver GET /azure-inventario/resumo-por-assinatura). O 3º nível (recursos
// dentro do RG) reaproveita `AzureRecursoInventario`/`getAzureRecursosInventario` direto.
export interface AzureResumoPorAssinaturaItem {
  subscription_id?: string
  resource_group?: string
  total: number
  por_tipo: { tipo: string; total: number }[]
}
export interface AzureResumoPorAssinaturaResposta {
  nivel: 'assinatura' | 'resource_group'
  itens: AzureResumoPorAssinaturaItem[]
}

export interface AzureRecursoDetalheResposta {
  recurso: AzureRecursoInventario
  eventos: AzureAuditoriaEvento[]
  custo_diario: { cost_date: string; custo: number }[]
  // Custo de TODO o Resource Group (não só deste resource_id) — pedido do usuário: o custo
  // direto por recurso fica zerado pra VMs/discos efêmeros de cluster Databricks (a Azure
  // recria essas instâncias em horas, o resource_id exato raramente sobrevive até o billing
  // ser publicado, ~2-3 dias depois). O RG agrega todo o ambiente, sempre populado.
  custo_resource_group: number
  resource_group_recursos: number
  // SKU/tipo (2026-08-31, pedido do usuário: "colar o SKU da Máquina, tipo de Disco e Etc")
  // — extraído da linha de billing mais recente que casa com este recurso. `origem:'direto'`
  // = billing do próprio resource_id; `'rg_mesmo_tipo'` = fallback (nenhum billing direto —
  // comum pra recursos efêmeros de cluster — usa outro recurso do MESMO tipo no MESMO
  // Resource Group como aproximação). `null` = nenhuma das duas fontes teve dado.
  billing_detalhe: {
    meter_category: string | null
    meter_sub_category: string | null
    meter_name: string | null
    product_name: string | null
    sku: string | null
    vcpus: number | null
    origem: 'direto' | 'rg_mesmo_tipo'
  } | null
}

// ── Melhorias inspiradas no Azure Resource Inventory (ARI — github.com/microsoft/ARI),
// 2026-09-02, pedido do usuário: "ajuste o nosso inventario para algo desse Nivel do Git" ──

// Detalhe completo de UM recurso via Resource Graph (propriedades reais da Azure, ao vivo —
// não armazenado). `properties`/`sku`/`tags` variam MUITO por tipo de recurso (VM traz
// vmSize/osProfile, disco traz diskSizeGB, VNet traz addressSpace/subnets...) — por isso
// tipados como `unknown`, mostrados como JSON formatado no frontend em vez de tentar mapear
// campo por campo pra cada um dos milhares de tipos de recurso possíveis no Azure.
export interface AzureRecursoArmDetalhe {
  id: string
  name: string
  type: string
  resourceGroup: string
  location: string | null
  sku: unknown
  properties: unknown
  tags: unknown
}

// Recomendações do Azure Advisor — ver GET /azure-inventario/advisor. Sem campo de
// "economia estimada": a API base do Advisor não retorna um valor numérico de savings,
// só o texto livre `beneficio_potencial`.
export type AzureAdvisorCategoria = 'Cost' | 'Security' | 'HighAvailability' | 'Performance' | 'OperationalExcellence'
export type AzureAdvisorImpacto = 'High' | 'Medium' | 'Low'
export interface AzureAdvisorItem {
  id: string
  subscription_id: string
  categoria: AzureAdvisorCategoria | null
  impacto: AzureAdvisorImpacto | null
  tipo_recurso: string | null
  recurso: string | null
  resource_id: string | null
  problema: string | null
  solucao: string | null
  beneficio_potencial: string | null
}
export interface AzureAdvisorResposta {
  total: number
  itens: AzureAdvisorItem[]
  por_categoria: Record<string, number>
  erros: { subscription_id: string; erro: string }[]
}

// Topologia de rede — VNets, subnets e peerings de uma assinatura (ver GET
// /azure-inventario/rede-topologia). Renderizado como diagrama SVG simples, sem lib nova.
export interface AzureRedeSubnet {
  nome: string
  prefixo: string | null
}
export interface AzureRedePeering {
  vnet_remoto_id: string
  estado: string | null
}
export interface AzureRedeVNet {
  id: string
  nome: string
  resource_group: string
  address_space: string[]
  subnets: AzureRedeSubnet[]
  peerings: AzureRedePeering[]
}
export interface AzureRedeTopologiaResposta {
  vnets: AzureRedeVNet[]
}
