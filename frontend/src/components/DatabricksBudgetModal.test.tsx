import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksBudgetModal from './DatabricksBudgetModal'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksBudget } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

const existingBudget: DatabricksBudget = {
  id: 5, nome: 'Orçamento Time Dados', workspace_id: 'ws-123', valor_mensal: 5000,
  ativo: true, criado_em: '2026-01-01T00:00:00.000Z', atualizado_em: '2026-01-01T00:00:00.000Z',
}

function renderWithClient(budget: DatabricksBudget | null, workspaces: string[] = ['ws-123', 'ws-456']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabricksBudgetModal budget={budget} workspaces={workspaces} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('DatabricksBudgetModal', () => {
  it('cria um orçamento novo com escopo "Todos os workspaces" por padrão', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento Mensal')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '3000')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksBudget).toHaveBeenCalledWith({
      nome: 'Orçamento Mensal', workspace_id: null, valor_mensal: 3000, ativo: true,
    })
  })

  it('cria um orçamento escopado a um workspace específico', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento ws-456')
    await user.selectOptions(screen.getByLabelText('Escopo'), 'ws-456')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '1200')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksBudget).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: 'ws-456' }),
    )
  })

  it('edita um orçamento existente pré-preenchendo os campos', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.updateDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(existingBudget)

    expect(screen.getByLabelText('Nome')).toHaveValue('Orçamento Time Dados')
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue(5000)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.updateDatabricksBudget).toHaveBeenCalledWith(5, {
      nome: 'Orçamento Time Dados', workspace_id: 'ws-123', valor_mensal: 5000, ativo: true,
    })
  })

  it('desabilita "Salvar" enquanto nome ou valor mensal estiverem vazios', () => {
    renderWithClient(null)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
