import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import GenieBudgetModal from './GenieBudgetModal'
import * as genieBudgetsApi from '../api/genieBudgets'
import type { GenieBudget } from '../types/genieBudgets'

vi.mock('../api/genieBudgets')

const createdBudget: GenieBudget = {
  budget_configuration_id: 'gb-1', display_name: 'Quota Teste', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
  alert_configurations: [],
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <GenieBudgetModal onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('GenieBudgetModal', () => {
  it('cria uma quota com ação de alerta (EMAIL_NOTIFICATION) sem exigir confirmação extra', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota Teste')
    await user.type(screen.getByLabelText('Limite mensal (US$)'), '500')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'Quota Teste',
      threshold: expect.objectContaining({ quantity_threshold: '500', action_type: 'EMAIL_NOTIFICATION' }),
      confirmar_bloqueio: undefined,
    }))
  })

  it('bloqueia "Salvar" ao escolher ação de bloqueio até marcar a confirmação explícita', async () => {
    const user = userEvent.setup()
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota Bloqueio')
    await user.type(screen.getByLabelText('Limite mensal (US$)'), '200')
    await user.selectOptions(screen.getByLabelText('Ação ao atingir o limite'), 'BLOCK_USAGE')

    expect(screen.getByText('⚠ Esta ação bloqueia acesso real ao Genie')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Criar quota com bloqueio/ })).toBeDisabled()

    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    expect(screen.getByRole('button', { name: /Criar quota com bloqueio/ })).not.toBeDisabled()
  })

  it('envia confirmar_bloqueio:true só depois de marcar o checkbox', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota Bloqueio')
    await user.type(screen.getByLabelText('Limite mensal (US$)'), '200')
    await user.selectOptions(screen.getByLabelText('Ação ao atingir o limite'), 'BLOCK_USAGE')
    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    await user.click(screen.getByRole('button', { name: /Criar quota com bloqueio/ }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      threshold: expect.objectContaining({ action_type: 'BLOCK_USAGE' }),
      confirmar_bloqueio: true,
    }))
  })

  it('desmarcar o checkbox ao trocar de ação some com o aviso de bloqueio', async () => {
    const user = userEvent.setup()
    renderWithClient()

    await user.selectOptions(screen.getByLabelText('Ação ao atingir o limite'), 'BLOCK_USAGE')
    expect(screen.getByText('⚠ Esta ação bloqueia acesso real ao Genie')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Ação ao atingir o limite'), 'EMAIL_NOTIFICATION')
    expect(screen.queryByText('⚠ Esta ação bloqueia acesso real ao Genie')).not.toBeInTheDocument()
  })

  it('inclui tags e workspace ids no payload', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota com filtros')
    await user.type(screen.getByLabelText('Workspace IDs (opcional, separados por vírgula)'), '111, 222')
    await user.click(screen.getByRole('button', { name: '+ Adicionar tag' }))
    await user.type(screen.getByPlaceholderText('chave'), 'projeto')
    await user.type(screen.getByPlaceholderText('valor'), 'finops-core')
    await user.type(screen.getByLabelText('Limite mensal (US$)'), '300')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      workspace_ids: [111, 222],
      tags: [{ key: 'projeto', value: 'finops-core' }],
    }))
  })

  it('desabilita "Salvar" enquanto nome ou limite estiverem vazios', () => {
    renderWithClient()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
