import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listSPs } from '../api/coleta'

const TENANT_FILTER_KEY = 'global_tenant_filter'

interface TenantFilterContextType {
  selectedTenantId: number | null
  setSPFilter: (id: number | null) => void
  /** Nome da SP selecionada — pra mensagens de estado vazio. null quando não há filtro. */
  tenantNome: string | null
  /** Assinaturas da SP selecionada (minúsculas). null = sem filtro ativo. */
  subscriptionIds: Set<string> | null
  /**
   * Única forma confiável de atribuir uma linha a uma SP: as SPs cadastradas não
   * compartilham assinaturas, então `subscription_id` já determina a dona. Não existe
   * (nem precisa existir) uma coluna `sp_id` nas tabelas de dados.
   */
  matchSubscription: (subscriptionId: string | null | undefined) => boolean
}

const TenantFilterContext = createContext<TenantFilterContextType | undefined>(undefined)

export function TenantFilterProvider({ children }: { children: ReactNode }) {
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(() => {
    const stored = localStorage.getItem(TENANT_FILTER_KEY)
    return stored ? parseInt(stored, 10) : null
  })

  const spsQuery = useQuery({
    queryKey: ['coleta-sps'],
    queryFn: () => listSPs().then((sps) => sps.filter((sp) => sp.ativo)),
  })

  function setSPFilter(id: number | null) {
    setSelectedTenantId(id)
    if (id === null) {
      localStorage.removeItem(TENANT_FILTER_KEY)
    } else {
      localStorage.setItem(TENANT_FILTER_KEY, String(id))
    }
  }

  const spSelecionada = selectedTenantId === null
    ? undefined
    : spsQuery.data?.find((sp) => sp.id === selectedTenantId)

  const subscriptionIds = useMemo(() => {
    if (!spSelecionada) return null
    return new Set(
      (spSelecionada.subscription_ids || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
  }, [spSelecionada])

  // Enquanto a lista de SPs não carregou, `subscriptionIds` é null e nada é filtrado —
  // mostrar tudo por um instante é melhor que piscar uma tela vazia.
  const matchSubscription = useCallback(
    (subscriptionId: string | null | undefined) => {
      if (!subscriptionIds) return true
      return !!subscriptionId && subscriptionIds.has(subscriptionId.toLowerCase())
    },
    [subscriptionIds],
  )

  return (
    <TenantFilterContext.Provider
      value={{
        selectedTenantId,
        setSPFilter,
        tenantNome: spSelecionada?.nome?.trim() || null,
        subscriptionIds,
        matchSubscription,
      }}
    >
      {children}
    </TenantFilterContext.Provider>
  )
}

export function useTenantFilter() {
  const context = useContext(TenantFilterContext)
  if (!context) {
    throw new Error('useTenantFilter must be used within TenantFilterProvider')
  }
  return context
}
