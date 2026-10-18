// Contrato de GET /api/public/orfaos (server.js). Deliberadamente sem resource_id,
// subscription_id ou erros: o portal é público e não deve expor o caminho completo dos recursos.
// `subscription_name` é a exceção — rótulo legível, não path pro recurso, e o admin já o vê ao
// curar a allowlist de assinaturas expostas (ver `orfaos_subscription_ids` em server.js).

export type OrfaoCategoria =
  | 'disco_orfao' | 'snapshot_antigo' | 'ip_solto' | 'nic_orfa'
  | 'app_service_plan_vazio' | 'lb_sem_backend' | 'appgw_sem_backend' | 'vm_parada'

export interface OrfaoItem {
  nome: string | null
  categoria: OrfaoCategoria
  subscription_name: string | null
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
  /** Economia já realizada com órfãos excluídos. Só os totais: a lista de itens traz
   *  resource_id/subscription_id, que esta rota pública nunca expõe. null se a apuração falhou. */
  saving: {
    /** Já descontado o snapshot de retenção dos 90 dias, que ainda custa. */
    economia_mensal: number
    economia_acumulada: number
    recursos_eliminados: number
  } | null
  itens: OrfaoItem[]
}
