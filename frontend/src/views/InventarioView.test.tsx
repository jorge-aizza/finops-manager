import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import InventarioView from './InventarioView'
import * as azureInventarioApi from '../api/azureInventario'
import * as coletaApi from '../api/coleta'
import * as calculadoraApi from '../api/calculadora'
import type { AzureInventarioConfig, AzureInventarioStatus } from '../types/azureInventario'

vi.mock('../api/azureInventario')
vi.mock('../api/coleta')
vi.mock('../api/calculadora')

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InventarioView />
    </QueryClientProvider>,
  )
}

const mockConfig: AzureInventarioConfig = {
  id: 1, ativo: true, retencao_dias: 180, sp_id: 5, subscription_ids: null,
  ultimo_evento_em: '2026-08-29T10:00:00Z', criado_em: '', atualizado_em: '',
}
const mockStatus: AzureInventarioStatus = {
  em_execucao: false, iniciada_em: null,
  progresso: { fase: '', sub_atual: '', sub_idx: 0, sub_total: 0, eventos: 0, novos: 0, atualizados: 0, excluidos: 0, log: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
  vi.mocked(azureInventarioApi.getAzureInventarioConfig).mockResolvedValue(mockConfig)
  vi.mocked(azureInventarioApi.getAzureInventarioStatus).mockResolvedValue(mockStatus)
  vi.mocked(azureInventarioApi.getAzureInventarioColetaHistorico).mockResolvedValue([])
  vi.mocked(azureInventarioApi.getAzureCrescimento).mockResolvedValue({ periodo: { inicio: '', fim: '' }, dias: [] })
  vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({ total: 0, recursos: [] })
  vi.mocked(azureInventarioApi.getAzureAuditoriaEventos).mockResolvedValue({ periodo: { inicio: '', fim: '' }, total: 0, eventos: [] })
  vi.mocked(coletaApi.listSPs).mockResolvedValue([])
  vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([])
})

describe('InventarioView', () => {
  it('mostra o gráfico de crescimento e a aba Recursos por padrão', async () => {
    vi.mocked(azureInventarioApi.getAzureCrescimento).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      dias: [{ cost_date: '2026-08-28', recursos: 40 }, { cost_date: '2026-08-29', recursos: 42 }],
    })
    renderWithClient()
    expect(await screen.findByText('Crescimento de Recursos')).toBeInTheDocument()
    expect(await screen.findByText('Recursos (Inventário)')).toBeInTheDocument()
  })

  it('lista recursos com custo acumulado, e mostra "desconhecido" quando não há criado_por', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      }],
    })
    renderWithClient()
    expect(await screen.findByText('vm-teste')).toBeInTheDocument()
    expect(screen.getByText('R$ 123,45')).toBeInTheDocument()
    expect(screen.getByText('desconhecido')).toBeInTheDocument()
  })

  it('aba Auditoria mostra eventos com badge de ação', async () => {
    vi.mocked(azureInventarioApi.getAzureAuditoriaEventos).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      total: 1,
      eventos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', acao: 'CRIACAO', autor: 'joao@vivo.com.br',
        quando: '2026-08-20T10:00:00Z', operation_name: 'Microsoft.Compute/virtualMachines/write', correlation_id: null, criado_em: '',
      }],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Auditoria' }))
    expect(await screen.findByText('✚ Criação')).toBeInTheDocument()
    expect(screen.getByText('joao@vivo.com.br')).toBeInTheDocument()
  })

  it('aba Configuração pré-preenche o formulário e permite salvar', async () => {
    vi.mocked(coletaApi.listSPs).mockResolvedValue([
      { id: 5, nome: 'SP Produção', tenant_id: '', client_id: '', ativo: true, is_padrao: true, expiracao_secret: null, billing_account_id: null, billing_profile_id: null, modo_coleta: 'subscription', subscription_ids: 'sub-1', granularidade_dias: 7, dia_execucao: 5, hora_execucao: null, dias_semana: null } as never,
    ])
    vi.mocked(azureInventarioApi.salvarAzureInventarioConfig).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(azureInventarioApi.salvarAzureInventarioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ativo: true, retencao_dias: 180, sp_id: 5 }),
    ))
  })

  it('lista as assinaturas por nome pra seleção, e inclui a marcada no salvar', async () => {
    vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([
      { subscription_id: 'sub-1', subscription_name: 'Development', periodo_inicio: null, periodo_fim: null, moeda: null },
      { subscription_id: 'sub-2', subscription_name: 'Production', periodo_inicio: null, periodo_fim: null, moeda: null },
    ])
    vi.mocked(azureInventarioApi.salvarAzureInventarioConfig).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))

    expect(await screen.findByText('Development')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()

    await user.click(screen.getByText('Production'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(azureInventarioApi.salvarAzureInventarioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_ids: 'sub-2' }),
    ))
  })

  it('botão "Coletar Agora" dispara a coleta manual', async () => {
    vi.mocked(azureInventarioApi.coletarAzureInventario).mockResolvedValue({ ok: true, message: 'Coleta de Inventário iniciada' })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))
    await user.click(await screen.findByRole('button', { name: '▶ Coletar Agora' }))
    await waitFor(() => expect(azureInventarioApi.coletarAzureInventario).toHaveBeenCalled())
  })
})
