import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

const TENANT_FILTER_KEY = 'global_tenant_filter'

interface TenantFilterContextType {
  selectedTenantId: number | null
  setSPFilter: (id: number | null) => void
}

const TenantFilterContext = createContext<TenantFilterContextType | undefined>(undefined)

export function TenantFilterProvider({ children }: { children: ReactNode }) {
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(() => {
    const stored = localStorage.getItem(TENANT_FILTER_KEY)
    return stored ? parseInt(stored, 10) : null
  })

  function setSPFilter(id: number | null) {
    setSelectedTenantId(id)
    if (id === null) {
      localStorage.removeItem(TENANT_FILTER_KEY)
    } else {
      localStorage.setItem(TENANT_FILTER_KEY, String(id))
    }
  }

  return (
    <TenantFilterContext.Provider value={{ selectedTenantId, setSPFilter }}>
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
