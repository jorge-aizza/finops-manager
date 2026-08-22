import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import CalculadoraView from './CalculadoraView'
import * as calcApi from '../api/calculadora'
import * as projetosApi from '../api/projetos'
import * as estimativasApi from '../api/estimativas'
import type { RecursoBilling, ResourceGroupOption, SubscriptionOption } from '../types/calculadora'

vi.mock('../api/calculadora', async () => {
  const actual = await vi.importActual<typeof calcApi>('../api/calculadora')
  return { ...actual, listSubscriptions: vi.fn(), listResourceGroups: vi.fn(), getRecursos: vi.fn(), getReconciliacao: vi.fn(), getDetalheDiario: vi.fn(), getPorServico: vi.fn() }
})
vi.mock('../api/projetos')
vi.mock('../api/estimativas')

const mockSubs: SubscriptionOption[] = [
  { subscription_id: 'sub-1', subscription_name: 'Assinatura Produção', periodo_inicio: '2026-07-01', periodo_fim: '2026-08-01', moeda: 'BRL' },
]

const mockRgs: ResourceGroupOption[] = [
  { resource_group_name: 'RG-PROD', moeda: 'BRL', managed_type: null, managed_label: null, parent_rg: null },
]

function makeRecurso(overrides: Partial<RecursoBilling>): RecursoBilling {
  return {
    resource_id: 'r1', resource_group_name: 'RG-PROD', nome_recurso: 'vm-produção-01',
    categoria: 'Virtual Machines', meter_categories: 'D4s v3', subcategoria: null,
    produto: null, consumed_service: 'Microsoft.Compute', charge_type: 'Usage',
    pricing_model: 'OnDemand', publisher_type: null, publisher_name: null,
    regiao: null, location: null, moeda: 'BRL', unidade: '1 Hour', tipo_custo: 'hora',
    taxa_cambio: 0, custo_hora_billing: 2, usa_amortizado: false, taxa_hora_rate: 0,
    custo_uom_billing: 0, custo_uom_usd: 0, dias_ativos: 30, total_billing: 1440,
    total_usd: 0, total_qty: 720, custo_mes_billing: 1440, custo_dia_billing: 48,
    custo_dia_usd: 0, custo_hora_usd: 0, total_upq_brl: 0, total_upq_usd: 0,
    horas_reais: 720, soma_h_driver: 0, usa_30d: false,
    ...overrides,
  }
}

const mockRecursos: RecursoBilling[] = [makeRecurso({})]

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CalculadoraView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(calcApi.listSubscriptions).mockResolvedValue(mockSubs)
  vi.mocked(calcApi.listResourceGroups).mockResolvedValue(mockRgs)
  vi.mocked(calcApi.getRecursos).mockResolvedValue(mockRecursos)
  vi.mocked(calcApi.getReconciliacao).mockResolvedValue({ por_tipo: [], por_moeda: [], total_bruto: 0, total_excluido: 0, total_sistema: 0 })
  vi.mocked(projetosApi.listProjetos).mockResolvedValue([
    { id: 1, nome: 'Projeto Alpha', diretoria: 'TI', descricao: null, status: 'Ativo', criado_em: '', atualizado_em: '' },
  ])
  vi.mocked(estimativasApi.createEstimativa).mockResolvedValue({} as never)
  window.showToast = vi.fn()
})

async function selecionarSubEBuscar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('— selecione —', { selector: 'span' }))
  await user.click(await screen.findByText('Assinatura Produção', { selector: '.cms-option-label' }))
  await user.click(screen.getByRole('button', { name: 'OK ✓' }))

  await user.click(screen.getByText('— selecione —', { selector: 'span' }))
  await user.click(await screen.findByText('RG-PROD', { selector: '.cms-option-label' }))
  await user.click(screen.getByRole('button', { name: 'OK ✓' }))

  await user.click(screen.getByRole('button', { name: 'Buscar' }))
  await screen.findByText('vm-produção-01')
}

describe('CalculadoraView', () => {
  it('mostra a tela vazia inicial pedindo pra selecionar uma assinatura', async () => {
    renderWithClient()
    expect(await screen.findByText(/Selecione uma/)).toBeInTheDocument()
  });

  it('lista assinaturas e resource groups, busca recursos e exibe a tabela', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)
    expect(calcApi.getRecursos).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_id: ['sub-1'], resource_group: ['RG-PROD'] }),
    )
  });

  it('seleciona um recurso e habilita o botão Estimar', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const estimarBtn = screen.getByRole('button', { name: 'Estimar' })
    expect(estimarBtn).toBeDisabled()

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])

    await waitFor(() => expect(screen.getByRole('button', { name: 'Estimar' })).not.toBeDisabled())
  });

  it('abre o overlay Configurar Estimativa e mostra o Total Final calculado', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    await screen.findByText('Total Final')
    // custo_hora_billing=2, chGlobal default=720h -> 1440 subtotal;
    // + imposto 18.65% (268,56) + condomínio 13% (187,20) = 1.895,76 total final
    const totalsCard = screen.getByText('Total Final').closest<HTMLElement>('.crcard-ov')!
    expect(within(totalsCard).getByText('R$ 1.895,76')).toBeInTheDocument()
  });

  it('filtro de texto esconde recursos que não combinam', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    await user.type(screen.getByPlaceholderText('Filtrar recursos...'), 'inexistente-xyz')
    expect(await screen.findByText('Nenhum recurso encontrado para os filtros selecionados.')).toBeInTheDocument()
  });

  it('"Visualizar Estimativa" abre o InvoiceModal, valida campos obrigatórios e gera o preview do PDF (sem bridge pro legado)', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))
    await screen.findByText('Total Final')

    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))

    // InvoiceModal (#cinv-modal) abriu — Configurar Estimativa some, formulário de invoice aparece
    await screen.findByText('Gerar Estimativa')
    expect(screen.queryByText('Configurar Estimativa')).not.toBeInTheDocument()

    // Sem projeto/motivo — bloqueia e mostra erro, sem chamar createEstimativa
    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))
    expect(await screen.findByText('Selecione um projeto.')).toBeInTheDocument()
    expect(estimativasApi.createEstimativa).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('Projeto *'), '1')
    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))
    expect(await screen.findByText('Informe o motivo da solicitação do ambiente ligado.')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Informe o motivo da solicitação do ambiente ligado...'), 'Projeto piloto')
    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))

    await waitFor(() => expect(estimativasApi.createEstimativa).toHaveBeenCalledWith(
      expect.objectContaining({ projeto_id: 1, observacoes: 'Projeto piloto' }),
    ))
    // InvoicePreviewModal abre com o iframe do PDF — InvoiceModal fecha
    expect(await screen.findByRole('button', { name: /Imprimir \/ Salvar PDF/ })).toBeInTheDocument()
    expect(screen.queryByText('Gerar Estimativa')).not.toBeInTheDocument()
  });

  it('botão Reconciliar abre o ReconciliacaoModal com dados reais (não depende de busca legada)', async () => {
    const user = userEvent.setup()
    vi.mocked(calcApi.getReconciliacao).mockResolvedValue({
      por_tipo: [{ charge_type: 'Usage', linhas: 10, total: 1000, excluido: false }],
      por_moeda: [{ moeda: 'BRL', total: 1000 }],
      total_bruto: 1000, total_excluido: 0, total_sistema: 1000,
    })
    renderWithClient()
    await selecionarSubEBuscar(user)

    await user.click(screen.getByRole('button', { name: '🔍 Reconciliar' }))

    const modal = (await screen.findByText('Reconciliação de Valores')).closest<HTMLElement>('.modal')!
    expect(await within(modal).findByText('Usage')).toBeInTheDocument()
    expect(calcApi.getReconciliacao).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_id: ['sub-1'], resource_group: ['RG-PROD'] }),
    )
  });
});
