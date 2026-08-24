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
  return {
    ...actual, listSubscriptions: vi.fn(), listResourceGroups: vi.fn(), getRecursos: vi.fn(), getReconciliacao: vi.fn(),
    getDetalheDiario: vi.fn(), getPorServico: vi.fn(), diagAzureCosts: vi.fn(), refreshAzureCache: vi.fn(),
  }
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

  // Bug real: os cards do overlay tinham perdido praticamente todo o detalhe
  // por-recurso do legado (badges de categoria/charge_type/serviço, metadados
  // UoM/Qtd/H.reais/Modelo, e a coluna "Cobrado") — só mostravam nome, RG, um
  // rótulo de coluna sem valor, horas e o Estimado final.
  it('card do recurso mostra badges, metadados e a coluna Cobrado (não só o Estimado)', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    const modal = (await screen.findByText(/Configurar Estimativa —/)).closest<HTMLElement>('.modal')!
    const card = within(modal).getByText('vm-produção-01').closest<HTMLElement>('.crcard-ov')!
    expect(within(card).getByText('Virtual Machines')).toBeInTheDocument() // badge categoria
    expect(within(card).getByText('Usage')).toBeInTheDocument() // badge charge_type
    expect(within(card).getByText('Microsoft.Compute')).toBeInTheDocument() // badge consumed_service
    expect(within(card).getByText('RG-PROD')).toBeInTheDocument() // badge RG
    expect(within(card).getByText(/1 Hour/)).toBeInTheDocument() // metadado UoM
    expect(within(card).getAllByText(/720/).length).toBeGreaterThan(0) // metadado Qtd/H.reais
    expect(within(card).getByText('OnDemand')).toBeInTheDocument() // metadado Modelo
    const cobradoLabel = within(card).getByText('Cobrado') // coluna nova
    expect(cobradoLabel.nextElementSibling).toHaveTextContent('R$ 1.440,00') // custo_hora_billing×720
    expect(within(card).getByText('Custo/h')).toBeInTheDocument() // label col1
    expect(within(card).getByText('R$ 2,00')).toBeInTheDocument() // valor col1 (custo_hora_billing)
  });

  // Bug real: o botão "🔍" ao lado do chip "Outros" (diagnóstico dos recursos
  // não classificados por tipoRecurso.ts) não tinha sido portado — não existia
  // nenhum jeito de ver POR QUE um recurso caiu em "Outros".
  it('botão 🔍 do chip "Outros" abre o diagnóstico agrupado por serviço', async () => {
    const user = userEvent.setup()
    vi.mocked(calcApi.getRecursos).mockResolvedValueOnce([
      makeRecurso({}), // classifica como VMs (consumed_service: Microsoft.Compute)
      makeRecurso({
        resource_id: 'r2', nome_recurso: 'recurso-misterioso', consumed_service: 'Microsoft.Misterioso',
        charge_type: 'Usage', pricing_model: 'OnDemand', meter_categories: 'Categoria Desconhecida',
      }),
    ])
    renderWithClient()
    await selecionarSubEBuscar(user)

    await user.click(await screen.findByRole('button', { name: /🔍/ }))

    const diagModal = (await screen.findByText('🔍 Diagnóstico — Outros (1 recursos)')).closest<HTMLElement>('.modal')!
    expect(within(diagModal).getByText('Microsoft.Misterioso')).toBeInTheDocument()
    expect(within(diagModal).getByText('Categoria Desconhecida')).toBeInTheDocument()
    expect(within(diagModal).getByText(/recurso-misterioso/)).toBeInTheDocument()
  });

  // Bug real: quando o dropdown de Assinatura vem vazio (0 subscriptions),
  // não havia nenhum diagnóstico — só "Nenhum resultado", sem dizer se é
  // banco vazio ou cache desatualizado.
  it('dropdown de Assinatura sem resultados mostra diagnóstico com botão de rebuild', async () => {
    const user = userEvent.setup()
    vi.mocked(calcApi.listSubscriptions).mockResolvedValue([])
    vi.mocked(calcApi.diagAzureCosts).mockResolvedValue({
      azure_costs: { total: 500, com_sub: 0, com_data: 500 },
      subs_cache: { total: 0 }, rg_cache: { total: 0 },
      colunas_amostra: ['Date', 'Cost'], amostra_valores: null,
    })
    renderWithClient()

    await user.click(screen.getByText('— selecione —', { selector: 'span' }))

    expect(await screen.findByText(/subscription_id é nulo em todos/)).toBeInTheDocument()
    expect(screen.getByText(/Date, Cost/)).toBeInTheDocument()

    vi.mocked(calcApi.refreshAzureCache).mockResolvedValue({ subs: 3 })
    await user.click(screen.getByRole('button', { name: /Forçar rebuild de cache/ }))
    await waitFor(() => expect(calcApi.refreshAzureCache).toHaveBeenCalled())
  });

  // Bug real: o botão "📖 Legenda" (explica os selos/cores dos cards) não
  // tinha sido portado — nenhum jeito de consultar o que cada indicador
  // significa sem ler o código-fonte.
  it('botão "📖 Legenda" abre e fecha o painel explicativo', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    expect(screen.queryByText('Fonte do Preço')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Legenda/ }))
    expect(screen.getByText('Fonte do Preço')).toBeInTheDocument()
    expect(screen.getByText(/Cluster\/h/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Legenda/ }))
    expect(screen.queryByText('Fonte do Preço')).not.toBeInTheDocument()
  });

  // Bug real: Horário Livre resetava toda vez que o overlay era reaberto, mesmo
  // autenticado — só o valor default (`defaultHorarioLivre()`) era usado como
  // estado inicial, sem ler/escrever em localStorage (diferente das Taxas, que
  // já persistiam do mesmo jeito). Confirma que ativar Horário Livre, fechar e
  // reabrir o overlay preserva a escolha.
  it('Horário Livre persiste em localStorage entre aberturas do overlay', async () => {
    localStorage.removeItem('finops_horario_livre')
    const user = userEvent.setup()
    renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    const hlLabel = await screen.findByText('Horário Livre (desconta horas fora do expediente)')
    const hlCheckbox = hlLabel.parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement
    expect(hlCheckbox.checked).toBe(false)
    await user.click(hlCheckbox)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('finops_horario_livre')!).ativo).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    const hlLabel2 = await screen.findByText('Horário Livre (desconta horas fora do expediente)')
    const hlCheckbox2 = hlLabel2.parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement
    expect(hlCheckbox2.checked).toBe(true)
  });

  it('overlay Configurar Estimativa escapa via portal do overflow:hidden do container raiz da view', async () => {
    // Bug real: CalculadoraView.tsx tem overflow:hidden no container raiz —
    // sem portal, o modal ficava recortado, cobrindo só a área de conteúdo
    // (não sidebar/topbar) e, dependendo da posição, escondendo o rodapé de
    // dropdowns internos. Confirma que o modal escapou pra document.body.
    const user = userEvent.setup()
    const { container } = renderWithClient()
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    const overlayHeader = await screen.findByText(/Configurar Estimativa —/)
    expect(container.contains(overlayHeader)).toBe(false)
    expect(document.body.contains(overlayHeader)).toBe(true)
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

  it('não mostra mais o botão Reconciliar (removido a pedido do usuário)', async () => {
    renderWithClient()
    await selecionarSubEBuscar(userEvent.setup())
    expect(screen.queryByRole('button', { name: '🔍 Reconciliar' })).not.toBeInTheDocument()
  });
});
