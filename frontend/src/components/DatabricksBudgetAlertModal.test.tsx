import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksBudgetAlertModal from './DatabricksBudgetAlertModal'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksAlerta, DatabricksBudget } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

function budget(overrides: Partial<DatabricksBudget> = {}): DatabricksBudget {
  return {
    id: 1, nome: 'Orçamento Global', workspace_id: null, valor_mensal: 1000,
    ativo: true, criado_em: '2026-01-01T00:00:00.000Z', atualizado_em: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabricksBudgetAlertModal />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('DatabricksBudgetAlertModal', () => {
  it('não renderiza nada quando não há alertas', async () => {
    vi.mocked(databricksColetaApi.getDatabricksAlertas).mockResolvedValue([])
    renderWithClient()
    await waitFor(() => expect(databricksColetaApi.getDatabricksAlertas).toHaveBeenCalled())
    expect(screen.queryByText('⚠ Orçamentos Databricks')).not.toBeInTheDocument()
  })

  it('mostra o popup com a severidade de cada orçamento estourado', async () => {
    const alertas: DatabricksAlerta[] = [
      { budget: budget({ id: 1, nome: 'Estourado' }), custo_atual: 1200, pct: 1.2, severidade: 'estourado' },
      { budget: budget({ id: 2, nome: 'No limite', workspace_id: 'ws-1' }), custo_atual: 950, pct: 0.95, severidade: 'critico' },
    ]
    vi.mocked(databricksColetaApi.getDatabricksAlertas).mockResolvedValue(alertas)
    renderWithClient()

    expect(await screen.findByText('⚠ Orçamentos Databricks')).toBeInTheDocument()
    expect(screen.getByText('Estourado')).toBeInTheDocument()
    expect(screen.getByText('No limite')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent?.startsWith('ws-1') ?? false)).toBeInTheDocument()
  })

  it('fecha e persiste o dismiss em sessionStorage — não reaparece num remount seguinte', async () => {
    const alertas: DatabricksAlerta[] = [
      { budget: budget({ id: 7 }), custo_atual: 900, pct: 0.9, severidade: 'atencao' },
    ]
    vi.mocked(databricksColetaApi.getDatabricksAlertas).mockResolvedValue(alertas)
    const user = userEvent.setup()
    const { unmount } = renderWithClient()

    await screen.findByText('⚠ Orçamentos Databricks')
    await user.click(screen.getByRole('button', { name: 'Entendi' }))
    expect(screen.queryByText('⚠ Orçamentos Databricks')).not.toBeInTheDocument()
    unmount()

    renderWithClient()
    await waitFor(() => expect(databricksColetaApi.getDatabricksAlertas).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('⚠ Orçamentos Databricks')).not.toBeInTheDocument()
  })
})
