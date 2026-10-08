import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PublicCalculadoraView from './PublicCalculadoraView'
import * as calcPublicaApi from '../api/calculadoraPublica'
import type { RecursoBilling, ResourceGroupOption, SubscriptionOption } from '../types/calculadora'
import type { PortalConfig } from '../types/portal'

vi.mock('../api/calculadoraPublica')

const mockSubs: SubscriptionOption[] = [
  { subscription_id: 'sub-1', subscription_name: 'Assinatura Pública', periodo_inicio: '2026-07-01', periodo_fim: '2026-08-01', moeda: 'BRL' },
]

const mockRgs: ResourceGroupOption[] = [
  { resource_group_name: 'RG-PORTAL', moeda: 'BRL', managed_type: null, managed_label: null, parent_rg: null },
]

function makeRecurso(overrides: Partial<RecursoBilling>): RecursoBilling {
  return {
    resource_id: 'r1', resource_group_name: 'RG-PORTAL', nome_recurso: 'vm-portal-01',
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

function makeCfg(overrides: Partial<PortalConfig> = {}): PortalConfig {
  return {
    titulo: 'Portal FinOps Vivo', descricao: null, dominios_aceitos: [],
    taxa_imposto: 18.65, taxa_cond: 13, taxa_gordura: 0,
    imposto_microsoft: { ativo: false, taxa: 18.65 }, imposto_marketplace: { ativo: false, taxa: 18.65 },
    horario_livre: { ativo: false, inicio: '09:00', fim: '18:00', dias: [1, 2, 3, 4, 5], inicio_sab: '09:00', fim_sab: '18:00', inicio_dom: '09:00', fim_dom: '18:00' },
    solicitar_identificacao: false, permitir_selecao_periodo: true, permitir_selecao_recursos: true,
    ...overrides,
  }
}

function renderWithClient(cfg: PortalConfig, ident: { nome: string; email: string } | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicCalculadoraView cfg={cfg} ident={ident} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(calcPublicaApi.listSubscriptionsPublica).mockResolvedValue(mockSubs)
  vi.mocked(calcPublicaApi.listResourceGroupsPublica).mockResolvedValue(mockRgs)
  vi.mocked(calcPublicaApi.getRecursosPublica).mockResolvedValue(mockRecursos)
  vi.mocked(calcPublicaApi.listProjetosPublica).mockResolvedValue([
    { id: 1, nome: 'Projeto Portal', descricao: null, status: 'Ativo' },
  ])
  vi.mocked(calcPublicaApi.createEstimativaPublica).mockResolvedValue({} as never)
  window.showToast = vi.fn()
})

async function selecionarSubEBuscar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('— selecione —', { selector: 'span' }))
  await user.click(await screen.findByText('Assinatura Pública', { selector: '.cms-option-label' }))
  await user.click(screen.getByRole('button', { name: 'OK ✓' }))

  await user.click(screen.getByText('— selecione —', { selector: 'span' }))
  await user.click(await screen.findByText('RG-PORTAL', { selector: '.cms-option-label' }))
  await user.click(screen.getByRole('button', { name: 'OK ✓' }))

  await user.click(screen.getByRole('button', { name: 'Buscar' }))
  await screen.findByText('vm-portal-01')
}

describe('PublicCalculadoraView', () => {
  it('busca recursos usando os endpoints /api/public/calculadora/* (não os privados)', async () => {
    const user = userEvent.setup()
    renderWithClient(makeCfg())
    await selecionarSubEBuscar(user)
    expect(calcPublicaApi.getRecursosPublica).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_id: ['sub-1'], resource_group: ['RG-PORTAL'] }),
    )
  });

  it('permitir_selecao_periodo=false: campos de data ficam desabilitados', async () => {
    renderWithClient(makeCfg({ permitir_selecao_periodo: false }))
    const inputs = document.querySelectorAll('input[type="date"]')
    expect(inputs.length).toBe(2)
    inputs.forEach((el) => expect(el).toBeDisabled())
  });

  it('permitir_selecao_recursos=false: seleciona tudo automaticamente e desabilita os checkboxes / esconde Sel.todos e Limpar', async () => {
    const user = userEvent.setup()
    renderWithClient(makeCfg({ permitir_selecao_recursos: false }))
    await selecionarSubEBuscar(user)

    expect(screen.queryByRole('button', { name: 'Sel. todos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument()

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.length).toBeGreaterThan(0)
    checkboxes.forEach((cb) => {
      expect(cb).toBeDisabled()
      expect(cb.checked).toBe(true)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Estimar' })).not.toBeDisabled())
  });

  it('imposto fica zerado com categorias desativadas e condomínio continua travado pela config do admin', async () => {
    const user = userEvent.setup()
    renderWithClient(makeCfg({ taxa_imposto: 20, taxa_cond: 15 }))
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))

    await screen.findByText('Total Final')
    const impostoInput = screen.getByDisplayValue('0') as HTMLInputElement
    const condInput = screen.getByDisplayValue('15') as HTMLInputElement
    expect(impostoInput).toBeDisabled()
    expect(condInput).toBeDisabled()
    expect(screen.queryByText(/Imposto \(/)).not.toBeInTheDocument()
    // Gordura nunca aparece no portal público
    expect(screen.queryByText('Gordura %')).not.toBeInTheDocument()
  });

  it('"Visualizar Estimativa" usa a API pública e pré-preenche responsável/e-mail da identificação', async () => {
    const user = userEvent.setup()
    renderWithClient(makeCfg(), { nome: 'Ana Souza', email: 'ana@empresa.com' })
    await selecionarSubEBuscar(user)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[checkboxes.length - 1])
    await user.click(screen.getByRole('button', { name: 'Estimar' }))
    await screen.findByText('Total Final')

    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))

    await screen.findByText('Gerar Estimativa')
    expect(screen.getByDisplayValue('Ana Souza')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ana@empresa.com')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Projeto *'), '1')
    await user.type(screen.getByPlaceholderText('Informe o motivo da solicitação do ambiente ligado...'), 'Teste portal público')
    await user.click(screen.getByRole('button', { name: 'Visualizar Estimativa' }))

    await waitFor(() => expect(calcPublicaApi.createEstimativaPublica).toHaveBeenCalledWith(
      expect.objectContaining({ projeto_id: 1, observacoes: 'Teste portal público' }),
    ))
    expect(await screen.findByRole('button', { name: /Imprimir \/ Salvar PDF/ })).toBeInTheDocument()
  });

  it('não mostra abas Por Data/Por Serviço nem botão Reconciliar (fora do escopo público)', async () => {
    const user = userEvent.setup()
    renderWithClient(makeCfg())
    await selecionarSubEBuscar(user)

    expect(screen.queryByText('Por Data')).not.toBeInTheDocument()
    expect(screen.queryByText('Por Serviço')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '🔍 Reconciliar' })).not.toBeInTheDocument()
  });
});
