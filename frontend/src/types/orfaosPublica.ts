// Contrato de GET /api/public/orfaos (server.js). Deliberadamente sem resource_id,
// subscription_id ou erros: o portal é público e não deve expor o caminho completo dos recursos.

export type OrfaoCategoria =
  | 'disco_orfao' | 'snapshot_antigo' | 'ip_solto' | 'nic_orfa'
  | 'app_service_plan_vazio' | 'lb_sem_backend' | 'appgw_sem_backend' | 'vm_parada'

export interface OrfaoItem {
  nome: string | null
  categoria: OrfaoCategoria
  resource_group: string | null
  sku: string | null
  tamanho_gb: number | null
  /** null (nunca 0) quando não há billing conhecido. */
  custo_mensal_estimado: number | null
  dias_orfao: number | null
}

export interface OrfaosPublicaResposta {
  gerado_em: string
  total_itens: number
  custo_mensal_estimado_total: number
  por_categoria: { categoria: OrfaoCategoria; itens: number; custo_mensal_estimado: number }[]
  itens: OrfaoItem[]
}
