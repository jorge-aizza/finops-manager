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

function renderWithClient(
  budget: GenieBudget | null = null,
  workspaces: { workspace_id: string; custo: number | null; nome: string }[] = [],
  workspaceState: { workspacesLoading?: boolean; workspacesError?: string | null; onRetryWorkspaces?: () => void } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <GenieBudgetModal budget={budget} workspaces={workspaces as never} {...workspaceState} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('GenieBudgetModal', () => {
  it('cria uma quota com níveis 50%, 80% e alerta+bloqueio em 100%', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota Teste')
    await user.type(screen.getByLabelText('Teto mensal (US$)'), '500')
    await user.click(screen.getByLabelText('Toda a conta'))
    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    await user.click(screen.getByRole('button', { name: /Criar quota com bloqueio/ }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'Quota Teste',
      workspace_ids: [],
      monthly_limit_usd: '500',
      levels: [
        { percentage: 50, actions: ['EMAIL_NOTIFICATION'] },
        { percentage: 80, actions: ['EMAIL_NOTIFICATION'] },
        { percentage: 100, actions: ['EMAIL_NOTIFICATION', 'BLOCK_USAGE'] },
      ],
      confirmar_bloqueio: true,
    }))
  })

  it('exige confirmação explícita para o nível com bloqueio', () => {
    renderWithClient()

    expect(screen.getByText('⚠ Esta ação bloqueia acesso real ao Genie')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Criar quota com bloqueio/ })).toBeDisabled()
    expect(screen.getByLabelText('Bloquear no nível 3')).toBeChecked()
  })

  it('envia confirmar_bloqueio:true só depois de marcar o checkbox', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota Bloqueio')
    await user.type(screen.getByLabelText('Teto mensal (US$)'), '200')
    await user.click(screen.getByLabelText('Toda a conta'))
    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    await user.click(screen.getByRole('button', { name: /Criar quota com bloqueio/ }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      levels: expect.arrayContaining([expect.objectContaining({ percentage: 100, actions: ['EMAIL_NOTIFICATION', 'BLOCK_USAGE'] })]),
      confirmar_bloqueio: true,
    }))
  })

  it('remover a ação de bloqueio tira o aviso', async () => {
    const user = userEvent.setup()
    renderWithClient()

    expect(screen.getByText('⚠ Esta ação bloqueia acesso real ao Genie')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Bloquear no nível 3'))
    expect(screen.queryByText('⚠ Esta ação bloqueia acesso real ao Genie')).not.toBeInTheDocument()
  })

  it('inclui tags e workspace ids no payload', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    renderWithClient(null, [{ workspace_id: '111', nome: 'Workspace 111', custo: 12 }, { workspace_id: '222', nome: 'Workspace 222', custo: 8 }])

    await user.type(screen.getByLabelText('Nome'), 'Quota com filtros')
    await user.click(screen.getByLabelText('Workspaces específicos'))
    await user.click(screen.getByLabelText(/Workspace 111/))
    await user.click(screen.getByLabelText(/Workspace 222/))
    await user.click(screen.getByRole('button', { name: '+ Adicionar tag' }))
    await user.type(screen.getByPlaceholderText('chave'), 'projeto')
    await user.type(screen.getByPlaceholderText('valor'), 'finops-core')
    await user.type(screen.getByLabelText('Teto mensal (US$)'), '300')
    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    await user.click(screen.getByRole('button', { name: /Criar quota com bloqueio/ }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      workspace_ids: [111, 222],
      tags: [{ key: 'projeto', value: 'finops-core' }],
    }))
  })

  it('mostra o carregamento e oferece retry quando a Account API falha', async () => {
    const user = userEvent.setup()
    const onRetryWorkspaces = vi.fn()
    const erro = renderWithClient(null, [], { workspacesError: 'Account API indisponível', onRetryWorkspaces })
    await user.click(screen.getByLabelText('Workspaces específicos'))

    expect(screen.getByRole('alert')).toHaveTextContent('Account API indisponível')
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetryWorkspaces).toHaveBeenCalledOnce()

    erro.unmount()
    renderWithClient(null, [], { workspacesLoading: true })
    await user.click(screen.getByLabelText('Workspaces específicos'))
    expect(screen.getByRole('status')).toHaveTextContent('Carregando workspaces da Account API')
  })

  it('filtra workspaces por nome/ID sem descartar seleções que ficaram ocultas', async () => {
    const user = userEvent.setup()
    const budget: GenieBudget = {
      ...createdBudget,
      filter: { workspace_id: { values: [111, 222] } },
      alert_configurations: [{
        quantity_threshold: '100', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
        action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }],
      }],
    }
    renderWithClient(budget, [
      { workspace_id: '111', nome: 'Workspace Produção', custo: 12 },
      { workspace_id: '222', nome: 'Workspace Desenvolvimento', custo: null },
    ])

    const busca = screen.getByLabelText('Filtrar workspaces da conta')
    await user.type(busca, 'Desenvolvimento')
    expect(screen.queryByLabelText(/Workspace Produção/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Workspace Desenvolvimento/)).toBeChecked()
    expect(screen.getByText('Workspaces selecionados: 2 · exibindo 1 de 2.')).toBeInTheDocument()

    await user.clear(busca)
    expect(screen.getByLabelText(/Workspace Produção/)).toBeChecked()
  })

  it('preserva workspaces marcados ao alternar para toda a conta e voltar', async () => {
    const user = userEvent.setup()
    const budget: GenieBudget = {
      ...createdBudget,
      filter: { workspace_id: { values: [111] } },
      alert_configurations: [{
        quantity_threshold: '100', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
        action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }],
      }],
    }
    renderWithClient(budget, [{ workspace_id: '111', nome: 'Workspace Produção', custo: 12 }])

    await user.click(screen.getByLabelText('Toda a conta'))
    await user.click(screen.getByLabelText('Workspaces específicos'))
    expect(screen.getByLabelText(/Workspace Produção/)).toBeChecked()
  })

  it('desabilita "Salvar" enquanto nome ou limite estiverem vazios', () => {
    renderWithClient()
    expect(screen.getByRole('button', { name: /Criar quota com bloqueio/ })).toBeDisabled()
  })

  it('exige escolha explícita entre toda a conta e workspaces específicos', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await user.type(screen.getByLabelText('Nome'), 'Quota com escopo explícito')
    await user.type(screen.getByLabelText('Teto mensal (US$)'), '100')
    await user.click(screen.getByLabelText('Bloquear no nível 3'))
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()

    await user.click(screen.getByLabelText('Workspaces específicos'))
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()

    await user.click(screen.getByLabelText('Toda a conta'))
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })

  it('avisa que tags continuam restringindo o escopo da conta inteira', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await user.click(screen.getByLabelText('Toda a conta'))
    await user.click(screen.getByRole('button', { name: '+ Adicionar tag' }))
    await user.type(screen.getByPlaceholderText('chave'), 'ambiente')
    await user.type(screen.getByPlaceholderText('valor'), 'producao')

    expect(screen.getByText('A quota não terá filtro por workspace. As tags informadas abaixo ainda limitam os recursos incluídos.')).toBeInTheDocument()
  })

  it('overrides por usuário só aparecem com escopo "Por usuário"', async () => {
    const user = userEvent.setup()
    renderWithClient()
    expect(screen.queryByText(/Limites individuais por usuário/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Escopo do limite'), 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
    expect(screen.getByText(/Limites individuais por usuário/)).toBeInTheDocument()
  })

  it('busca usuário por e-mail, adiciona um override e envia principal_overrides no payload', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.createGenieBudget).mockResolvedValue(createdBudget)
    vi.mocked(genieBudgetsApi.searchGeniePrincipals).mockResolvedValue([{ id: '12345', nome: 'João Silva' }])
    renderWithClient()

    await user.type(screen.getByLabelText('Nome'), 'Quota com override')
    await user.type(screen.getByLabelText('Teto mensal (US$)'), '100')
    await user.selectOptions(screen.getByLabelText('Escopo do limite'), 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
    await user.click(screen.getByLabelText('Toda a conta'))

    await user.type(screen.getByPlaceholderText('parte do e-mail'), 'joao@vivo.com.br')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(genieBudgetsApi.searchGeniePrincipals).toHaveBeenCalledWith('user', 'joao@vivo.com.br')

    await user.click(await screen.findByText(/João Silva/))
    expect(screen.getByText('João Silva')).toBeInTheDocument()

    // sem preencher o limite do override ainda, "Salvar" continua bloqueado
    expect(screen.getByRole('button', { name: /Criar quota com bloqueio/ })).toBeDisabled()

    const overrideInputs = screen.getAllByPlaceholderText('US$')
    await user.type(overrideInputs[0], '50')
    await user.click(screen.getByLabelText('Entendo e quero bloquear o acesso ao atingir o limite'))
    await user.click(screen.getByRole('button', { name: /Criar quota com bloqueio/ }))

    expect(genieBudgetsApi.createGenieBudget).toHaveBeenCalledWith(expect.objectContaining({
      principal_overrides: [{ principal_id: 12345, override_threshold: '50' }],
    }))
  })

  it('busca por grupo usa tipo "group" na chamada da API', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.searchGeniePrincipals).mockResolvedValue([])
    renderWithClient()

    await user.selectOptions(screen.getByLabelText('Escopo do limite'), 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
    await user.selectOptions(screen.getByDisplayValue('Usuário'), 'group')
    await user.type(screen.getByPlaceholderText('parte do nome do grupo'), 'Time de Dados')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(genieBudgetsApi.searchGeniePrincipals).toHaveBeenCalledWith('group', 'Time de Dados')
  })

  it('remover um override tira ele da lista e do payload', async () => {
    const user = userEvent.setup()
    vi.mocked(genieBudgetsApi.searchGeniePrincipals).mockResolvedValue([{ id: '999', nome: 'Maria Souza' }])
    renderWithClient()

    await user.selectOptions(screen.getByLabelText('Escopo do limite'), 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
    await user.type(screen.getByPlaceholderText('parte do e-mail'), 'maria@vivo.com.br')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await user.click(await screen.findByText(/Maria Souza/))
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()

    await user.click(screen.getByTitle('Remover'))
    expect(screen.queryByText('Maria Souza')).not.toBeInTheDocument()
  })

  describe('modo edição', () => {
    const budgetExistente: GenieBudget = {
      budget_configuration_id: 'gb-existente', display_name: 'Quota Existente', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
      filter: { workspace_id: { values: [111, 222] }, tags: [{ key: 'projeto', value: { values: ['finops-core'] } }] },
      alert_configurations: [{
        quantity_threshold: '750', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
        action_configurations: [{ action_type: 'EMAIL_NOTIFICATION', target: 'finops@vivo.com.br' }],
        principal_overrides: [{ principal_id: 12345, override_threshold: '50' }],
      }],
    }

    it('pré-preenche todos os campos a partir do budget existente', () => {
      renderWithClient(budgetExistente)

      expect(screen.getByText('🧞 Editar Quota Genie')).toBeInTheDocument()
      expect(screen.getByLabelText('Nome')).toHaveValue('Quota Existente')
      expect(screen.getByText('Workspaces selecionados: 2 · exibindo 0 de 0.')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('chave')).toHaveValue('projeto')
      expect(screen.getByPlaceholderText('valor')).toHaveValue('finops-core')
      expect(screen.getByLabelText('Teto mensal (US$)')).toHaveValue(750)
      expect(screen.getByLabelText('Escopo do limite')).toHaveValue('ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
      expect(screen.getByLabelText('E-mail de destino dos alertas (opcional)')).toHaveValue('finops@vivo.com.br')
      expect(screen.getByLabelText('Workspaces específicos')).toBeChecked()
      // override existente não tem nome/e-mail na resposta da API — mostra o ID
      expect(screen.getByText('ID: 12345')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    })

    it('salvar chama updateGenieBudget com o id do budget, não createGenieBudget', async () => {
      const user = userEvent.setup()
      vi.mocked(genieBudgetsApi.updateGenieBudget).mockResolvedValue(budgetExistente)
      renderWithClient(budgetExistente)

      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      expect(genieBudgetsApi.updateGenieBudget).toHaveBeenCalledWith('gb-existente', expect.objectContaining({
        display_name: 'Quota Existente',
        workspace_ids: [111, 222],
      }))
      expect(genieBudgetsApi.createGenieBudget).not.toHaveBeenCalled()
    })

    it('editar uma quota que já bloqueia exige reconfirmar o checkbox de bloqueio', async () => {
      const bloqueioExistente: GenieBudget = {
        ...budgetExistente,
        alert_configurations: [{
          ...budgetExistente.alert_configurations[0],
          action_configurations: [{ action_type: 'BLOCK_USAGE' }],
        }],
      }
      renderWithClient(bloqueioExistente)

      expect(screen.getByText('⚠ Esta ação bloqueia acesso real ao Genie')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Salvar com bloqueio/ })).toBeDisabled()
    })
  })
})
