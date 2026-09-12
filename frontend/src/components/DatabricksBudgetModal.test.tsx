import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksBudgetModal from './DatabricksBudgetModal'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksBudget } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

const existingBudget: DatabricksBudget = {
  id: 5, nome: 'Orçamento Time Dados', escopo_tipo: 'workspace', workspace_id: 'ws-123',
  tag_key: null, tag_valor: null, usuario: null, valor_mensal: 5000, threshold_atencao: 75, threshold_critico: 90,
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
  vi.mocked(databricksColetaApi.getDatabricksTagKeys).mockResolvedValue(['projeto', 'time'])
  vi.mocked(databricksColetaApi.getDatabricksTagValues).mockResolvedValue([])
})

describe('DatabricksBudgetModal', () => {
  it('cria um orçamento global com thresholds padrão (75/90)', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento Mensal')
    await user.selectOptions(screen.getByLabelText('Tipo de escopo'), 'global')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '3000')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksBudget).toHaveBeenCalledWith({
      nome: 'Orçamento Mensal', escopo_tipo: 'global', workspace_id: null,
      tag_key: null, tag_valor: null, usuario: null, valor_mensal: 3000,
      threshold_atencao: 75, threshold_critico: 90, ativo: true,
    })
  })

  it('cria um orçamento escopado a um workspace específico', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento ws-456')
    await user.selectOptions(screen.getByLabelText('Tipo de escopo'), 'workspace')
    await user.selectOptions(screen.getByLabelText('Workspace'), 'ws-456')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '1200')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksBudget).toHaveBeenCalledWith(
      expect.objectContaining({ escopo_tipo: 'workspace', workspace_id: 'ws-456' }),
    )
  })

  it('cria um orçamento escopado por tag (projeto/time/centro de custo)', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento Projeto X')
    await user.selectOptions(screen.getByLabelText('Tipo de escopo'), 'tag')
    await user.type(screen.getByLabelText('Chave da tag'), 'projeto')
    await user.type(screen.getByLabelText('Valor da tag'), 'finops-core')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '800')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksBudget).toHaveBeenCalledWith(
      expect.objectContaining({ escopo_tipo: 'tag', workspace_id: null, tag_key: 'projeto', tag_valor: 'finops-core' }),
    )
  })

  it('bloqueia "Salvar" quando o threshold crítico não é maior que o de alerta', async () => {
    const user = userEvent.setup()
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome'), 'Orçamento Mensal')
    await user.selectOptions(screen.getByLabelText('Tipo de escopo'), 'global')
    await user.type(screen.getByLabelText('Valor mensal (R$)'), '3000')
    await user.clear(screen.getByLabelText('Crítico em (%)'))
    await user.type(screen.getByLabelText('Crítico em (%)'), '60') // menor que o "Alertar em" padrão (75)

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    expect(screen.getByText(/deve ser maior que "Alertar"/)).toBeInTheDocument()
  })

  it('edita um orçamento existente pré-preenchendo os campos', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.updateDatabricksBudget).mockResolvedValue(existingBudget)
    renderWithClient(existingBudget)

    expect(screen.getByLabelText('Nome')).toHaveValue('Orçamento Time Dados')
    expect(screen.getByLabelText('Tipo de escopo')).toHaveValue('workspace')
    expect(screen.getByLabelText('Workspace')).toHaveValue('ws-123')
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue(5000)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.updateDatabricksBudget).toHaveBeenCalledWith(5, {
      nome: 'Orçamento Time Dados', escopo_tipo: 'workspace', workspace_id: 'ws-123',
      tag_key: null, tag_valor: null, usuario: null, valor_mensal: 5000,
      threshold_atencao: 75, threshold_critico: 90, ativo: true,
    })
  })

  it('desabilita "Salvar" enquanto nome ou valor mensal estiverem vazios', () => {
    renderWithClient(null)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('busca os valores de tag conhecidos ao digitar a chave', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.getDatabricksTagValues).mockResolvedValue(['finops-core', 'ml-recomendacao'])
    renderWithClient(null)

    await user.selectOptions(screen.getByLabelText('Tipo de escopo'), 'tag')
    await user.type(screen.getByLabelText('Chave da tag'), 'projeto')

    await waitFor(() => expect(databricksColetaApi.getDatabricksTagValues).toHaveBeenCalledWith('projeto'))
  })
})
