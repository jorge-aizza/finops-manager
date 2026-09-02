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
  ultimo_evento_em: '2026-08-29T10:00:00Z', tags_obrigatorias: null, criado_em: '', atualizado_em: '',
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
  vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({ total: 0, recursos: [] })
  vi.mocked(azureInventarioApi.getAzureAuditoriaEventos).mockResolvedValue({ periodo: { inicio: '', fim: '' }, total: 0, eventos: [], por_tipo: [] })
  vi.mocked(azureInventarioApi.getAzureSkuHistorico).mockResolvedValue({ periodo: { inicio: '', fim: '' }, total: 0, mudancas: [] })
  vi.mocked(azureInventarioApi.getAzureResumoPorAssinatura).mockResolvedValue({ nivel: 'assinatura', itens: [] })
  vi.mocked(azureInventarioApi.getAzureCrescimentoLiquido).mockResolvedValue({ periodo: { inicio: '', fim: '' }, dias: [] })
  vi.mocked(azureInventarioApi.getAzureAdvisor).mockResolvedValue({ total: 0, itens: [], por_categoria: {}, erros: [] })
  vi.mocked(azureInventarioApi.getAzureRedeTopologia).mockResolvedValue({ vnets: [] })
  vi.mocked(azureInventarioApi.baixarAzureInventarioExcel).mockResolvedValue(undefined)
  vi.mocked(azureInventarioApi.getAzureInventarioComparativo).mockResolvedValue({
    periodo_a: { inicio: '', fim: '', total_recursos: 0, custo_total: 0, criados: 0, atualizados: 0, excluidos: 0 },
    periodo_b: { inicio: '', fim: '', total_recursos: 0, custo_total: 0, criados: 0, atualizados: 0, excluidos: 0 },
  })
  vi.mocked(coletaApi.listSPs).mockResolvedValue([])
  vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([])
})

describe('InventarioView', () => {
  it('mostra a aba Recursos por padrão', async () => {
    renderWithClient()
    expect(await screen.findByText('Recursos (Inventário)')).toBeInTheDocument()
  })

  it('mostra o gráfico de Crescimento Líquido com o delta do período', async () => {
    vi.mocked(azureInventarioApi.getAzureCrescimentoLiquido).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      dias: [
        { dia: '2026-08-01', ativos: 100 },
        { dia: '2026-08-15', ativos: 108 },
        { dia: '2026-08-30', ativos: 112 },
      ],
    })
    renderWithClient()
    expect(await screen.findByText('Crescimento Líquido de Recursos')).toBeInTheDocument()
    expect(await screen.findByText(/100 → 112 recursos no período/)).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText(/Exclui recursos de cluster efêmero/)).toBeInTheDocument()
  })

  it('aba Por Assinatura navega Assinatura → Resource Group → Recurso', async () => {
    vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([
      { subscription_id: 'sub-1', subscription_name: 'Development', periodo_inicio: null, periodo_fim: null, moeda: null },
    ])
    vi.mocked(azureInventarioApi.getAzureResumoPorAssinatura).mockImplementation((subscriptionId?: string) => {
      if (!subscriptionId) {
        return Promise.resolve({
          nivel: 'assinatura' as const,
          itens: [{ subscription_id: 'sub-1', total: 3, por_tipo: [
            { tipo: 'Microsoft.Compute/virtualMachines', total: 2 },
            { tipo: 'Microsoft.Compute/disks', total: 1 },
          ] }],
        })
      }
      return Promise.resolve({
        nivel: 'resource_group' as const,
        itens: [{ resource_group: 'rg-1', total: 1, por_tipo: [{ tipo: 'Microsoft.Compute/virtualMachines', total: 1 }] }],
      })
    })
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 50,
      }],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Por Assinatura' }))

    expect(await screen.findByText('Development')).toBeInTheDocument()
    expect(screen.getByText('3 recursos ativos')).toBeInTheDocument()

    await user.click(screen.getByText('Development'))
    expect(await screen.findByText('rg-1')).toBeInTheDocument()
    expect(azureInventarioApi.getAzureResumoPorAssinatura).toHaveBeenLastCalledWith('sub-1')

    await user.click(screen.getByText('rg-1'))
    expect(await screen.findByText('vm-teste')).toBeInTheDocument()
    expect(azureInventarioApi.getAzureRecursosInventario).toHaveBeenLastCalledWith(
      expect.objectContaining({ subscription_id: 'sub-1', resource_group: 'rg-1', ativo: true }),
    )

    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 50,
      },
      eventos: [], custo_diario: [], custo_resource_group: 0, resource_group_recursos: 0, billing_detalhe: null,
    })
    await user.click(screen.getByText('vm-teste'))
    expect(await screen.findByText('Detalhe do Recurso')).toBeInTheDocument()
  })

  it('aba Por Assinatura separa VM, VM Scale Set e VM de Databricks em badges distintos', async () => {
    vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([
      { subscription_id: 'sub-1', subscription_name: 'Development', periodo_inicio: null, periodo_fim: null, moeda: null },
    ])
    vi.mocked(azureInventarioApi.getAzureResumoPorAssinatura).mockResolvedValue({
      nivel: 'assinatura',
      itens: [{
        subscription_id: 'sub-1', total: 6, por_tipo: [
          { tipo: 'Microsoft.Compute/virtualMachines', total: 3 },
          { tipo: 'Microsoft.Compute/virtualMachines::databricks', total: 2 },
          { tipo: 'Microsoft.Compute/virtualMachineScaleSets', total: 1 },
        ],
      }],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Por Assinatura' }))

    expect(await screen.findByText('Development')).toBeInTheDocument()
    expect(screen.getByTitle('VM')).toHaveTextContent('🖥️ 3')
    expect(screen.getByTitle('VM (Databricks)')).toHaveTextContent('🧱 2')
    expect(screen.getByTitle('VM Scale Set')).toHaveTextContent('🧩 1')
  })

  it('lista recursos com custo acumulado, e mostra "desconhecido" quando não há criado_por', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      }],
    })
    renderWithClient()
    expect(await screen.findByText('vm-teste')).toBeInTheDocument()
    expect(screen.getByText('R$ 123,45')).toBeInTheDocument()
    expect(screen.getByText('desconhecido')).toBeInTheDocument()
  })

  it('mostra o custo do Resource Group (~aproximado) na lista quando o custo direto do recurso é zero', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/databricks-rg-x/providers/Microsoft.Compute/disks/disco-efemero',
        resource_type: 'Microsoft.Compute/disks', resource_group: 'databricks-rg-x', nome: 'disco-efemero',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 4200.9, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 0,
      }],
    })
    renderWithClient()
    expect(await screen.findByText('disco-efemero')).toBeInTheDocument()
    expect(screen.getByText('~R$ 4.200,90')).toBeInTheDocument()
  })

  it('aba Auditoria mostra eventos com badge de ação', async () => {
    vi.mocked(azureInventarioApi.getAzureAuditoriaEventos).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      total: 1,
      eventos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste', acao: 'CRIACAO', autor: 'joao@vivo.com.br',
        quando: '2026-08-20T10:00:00Z', operation_name: 'Microsoft.Compute/virtualMachines/write', correlation_id: null, criado_em: '', autor_nome: null,
      }],
      por_tipo: [{ tipo: 'Microsoft.Compute/virtualMachines', total: 1 }],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Auditoria' }))
    expect(await screen.findByText('✚ Criação')).toBeInTheDocument()
    expect(screen.getByText('joao@vivo.com.br')).toBeInTheDocument()
    expect(screen.getByText('vm-teste')).toBeInTheDocument()
    expect(screen.getByText('Microsoft.Compute/virtualMachines')).toBeInTheDocument()
  })

  it('aba Auditoria mostra caixas por Tipo de Recurso e filtra a tabela ao clicar', async () => {
    vi.mocked(azureInventarioApi.getAzureAuditoriaEventos).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      total: 2,
      eventos: [
        {
          id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
          resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste', acao: 'CRIACAO', autor: 'joao@vivo.com.br',
          quando: '2026-08-20T10:00:00Z', operation_name: 'Microsoft.Compute/virtualMachines/write', correlation_id: null, criado_em: '', autor_nome: null,
        },
        {
          id: 2, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/disks/disco-x',
          resource_type: 'Microsoft.Compute/disks', resource_group: 'rg-1', nome: 'disco-x', acao: 'CRIACAO', autor: 'joao@vivo.com.br',
          quando: '2026-08-20T10:01:00Z', operation_name: 'Microsoft.Compute/disks/write', correlation_id: null, criado_em: '', autor_nome: null,
        },
      ],
      por_tipo: [
        { tipo: 'Microsoft.Compute/virtualMachines', total: 5 },
        { tipo: 'Microsoft.Compute/disks', total: 3 },
      ],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Auditoria' }))

    expect(await screen.findByText('VM')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Disco')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    await user.click(screen.getByText('VM'))
    await waitFor(() => expect(azureInventarioApi.getAzureAuditoriaEventos).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource_type: 'Microsoft.Compute/virtualMachines' }),
    ))
    expect(await screen.findByText('Tipo: VM ✕')).toBeInTheDocument()

    await user.click(screen.getByText('Tipo: VM ✕'))
    await waitFor(() => expect(azureInventarioApi.getAzureAuditoriaEventos).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource_type: undefined }),
    ))
  })

  it('aba Auditoria mostra o histórico de mudanças de SKU de VM e abre o detalhe ao clicar', async () => {
    vi.mocked(azureInventarioApi.getAzureSkuHistorico).mockResolvedValue({
      periodo: { inicio: '2026-08-01', fim: '2026-08-30' },
      total: 1,
      mudancas: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', sku_anterior: 'Standard_E4s_v3', sku_novo: 'Standard_E8s_v3',
        detectado_em: '2026-08-20T10:00:00Z', evento_autor: 'joao@vivo.com.br', evento_quando: '2026-08-20T09:58:00Z',
        nome: 'vm-teste', evento_autor_nome: null,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 50,
      },
      eventos: [], custo_diario: [], custo_resource_group: 0, resource_group_recursos: 0, billing_detalhe: null,
    } as never)
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Auditoria' }))

    expect(await screen.findByText('Mudanças de SKU de VM')).toBeInTheDocument()
    expect(screen.getByText('Standard_E4s_v3')).toBeInTheDocument()
    expect(screen.getByText('Standard_E8s_v3')).toBeInTheDocument()
    expect(screen.getByText('joao@vivo.com.br')).toBeInTheDocument()

    await user.click(screen.getByText('Standard_E4s_v3'))
    expect(await screen.findByText('Detalhe do Recurso')).toBeInTheDocument()
    expect(azureInventarioApi.getAzureRecursoDetalhe).toHaveBeenCalledWith(
      '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste', 'sub-1',
    )
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

  it('botão "Reconciliar (Resource Graph)" dispara a reconciliação', async () => {
    vi.mocked(azureInventarioApi.reconciliarAzureInventario).mockResolvedValue({ ok: true, message: 'Reconciliação via Resource Graph iniciada' })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))
    await user.click(await screen.findByRole('button', { name: '🔎 Reconciliar (Resource Graph)' }))
    await waitFor(() => expect(azureInventarioApi.reconciliarAzureInventario).toHaveBeenCalled())
  })

  it('botão "Exportar Excel" dispara o download com o filtro de ativo atual', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: '📊 Exportar Excel' }))
    await waitFor(() => expect(azureInventarioApi.baixarAzureInventarioExcel).toHaveBeenCalledWith({ ativo: true }))
    expect(window.showToast).toHaveBeenCalledWith('Inventário exportado.', 'success')
  })

  it('aba Advisor mostra badges por categoria e filtra a tabela ao clicar', async () => {
    vi.mocked(azureInventarioApi.getAzureAdvisor).mockResolvedValue({
      total: 2,
      itens: [
        { id: 'r1', subscription_id: 'sub-1', categoria: 'Cost', impacto: 'High', tipo_recurso: 'Microsoft.Compute/virtualMachines', recurso: 'vm-teste', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste', problema: 'VM subutilizada', solucao: 'Redimensionar', beneficio_potencial: 'Economize R$ 100/mês' },
        { id: 'r2', subscription_id: 'sub-1', categoria: 'Security', impacto: 'Medium', tipo_recurso: 'Microsoft.Storage/storageAccounts', recurso: 'storageteste', resource_id: null, problema: 'Habilitar criptografia', solucao: 'Habilitar', beneficio_potencial: null },
      ],
      por_categoria: { Cost: 1, Security: 1 },
      erros: [],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Advisor' }))

    expect(await screen.findByText('VM subutilizada')).toBeInTheDocument()
    expect(screen.getByText('Habilitar criptografia')).toBeInTheDocument()
    const botaoCategoria = screen.getByRole('button', { name: /💰 Custo/ })
    expect(botaoCategoria).toBeInTheDocument()

    await user.click(botaoCategoria)
    expect(screen.getByText('VM subutilizada')).toBeInTheDocument()
    expect(screen.queryByText('Habilitar criptografia')).not.toBeInTheDocument()
  })

  it('aba Rede mostra as VNets da assinatura selecionada com address space e subnets', async () => {
    vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([
      { subscription_id: 'sub-1', subscription_name: 'Development', periodo_inicio: null, periodo_fim: null, moeda: null },
    ])
    vi.mocked(azureInventarioApi.getAzureRedeTopologia).mockResolvedValue({
      vnets: [{
        id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-teste',
        nome: 'vnet-teste', resource_group: 'rg-net', address_space: ['10.0.0.0/16'],
        subnets: [{ nome: 'subnet-app', prefixo: '10.0.1.0/24' }], peerings: [],
      }],
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Rede' }))
    await user.selectOptions(await screen.findByRole('combobox'), 'sub-1')

    expect(await screen.findByText(/vnet-teste/)).toBeInTheDocument()
    expect(screen.getByText('10.0.0.0/16')).toBeInTheDocument()
    expect(screen.getByText('subnet-app')).toBeInTheDocument()
  })

  it('mostra o nome resolvido (Microsoft Graph) em vez do GUID quando disponível', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'c5d1363c-9e2c-434d-abfc-3470db9ecd37', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        criado_por_nome: 'Databricks Automation SP', atualizado_por_nome: null, excluido_por_nome: null,
        excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 0, custo_resource_group: 0,
      }],
    })
    renderWithClient()
    expect(await screen.findByText('Databricks Automation SP')).toBeInTheDocument()
    expect(screen.queryByText('c5d1363c-9e2c-434d-abfc-3470db9ecd37')).not.toBeInTheDocument()
  })

  it('botão "Resolver Nomes" dispara a resolução via Microsoft Graph', async () => {
    vi.mocked(azureInventarioApi.resolverAutoresInventario).mockResolvedValue({ resolvidos: 3, pendentes: 0 })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))
    await user.click(await screen.findByRole('button', { name: '🪪 Resolver Nomes' }))
    await waitFor(() => expect(azureInventarioApi.resolverAutoresInventario).toHaveBeenCalled())
  })

  it('mostra o monitor ao vivo com fase/contadores/log enquanto a coleta está em execução', async () => {
    vi.mocked(azureInventarioApi.getAzureInventarioStatus).mockResolvedValue({
      em_execucao: true, iniciada_em: '2026-08-30T10:00:00Z',
      progresso: {
        fase: '[1/2] Consultando Activity Log — sub-1', sub_atual: 'sub-1', sub_idx: 1, sub_total: 2,
        eventos: 12, novos: 5, atualizados: 6, excluidos: 1,
        log: [{ ts: '10:00:01', msg: 'Inventário — 2026-08-29T10:00:00Z → 2026-08-30T10:00:00Z | 2 subscription(s)' }],
      },
    })
    renderWithClient()
    expect(await screen.findByText('⏳ Coleta de Inventário em andamento')).toBeInTheDocument()
    expect(screen.getByText('[1/2] Consultando Activity Log — sub-1 (1/2)')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // eventos
    expect(screen.getByText('5')).toBeInTheDocument() // novos
    expect(screen.getByText(/Inventário — 2026-08-29T10:00:00Z/)).toBeInTheDocument()
    // enquanto está rodando não existe botão "Fechar" — só aparece após concluir
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument()
  })

  it('histórico de execuções aparece na aba Configuração', async () => {
    vi.mocked(azureInventarioApi.getAzureInventarioColetaHistorico).mockResolvedValue([
      { id: 1, iniciado_em: '2026-08-30T09:00:00Z', concluido_em: '2026-08-30T09:01:00Z', status: 'concluido', origem: 'agendado', periodo_inicio: null, periodo_fim: null, eventos_processados: 8, recursos_novos: 3, recursos_atualizados: 4, recursos_excluidos: 1, mensagem: '8 evento(s) | 3 novo(s), 4 atualizado(s), 1 excluído(s)' },
    ])
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Configuração' }))
    expect(await screen.findByText('⏰ Agendada')).toBeInTheDocument()
    expect(screen.getByText('concluido')).toBeInTheDocument()
    expect(screen.getByText('8 evento(s) | 3 novo(s), 4 atualizado(s), 1 excluído(s)')).toBeInTheDocument()
  })

  it('aba Comparativo mostra os dois períodos lado a lado com a diferença', async () => {
    vi.mocked(azureInventarioApi.getAzureInventarioComparativo).mockResolvedValue({
      periodo_a: { inicio: '2026-07-01', fim: '2026-07-30', total_recursos: 40, custo_total: 1000, criados: 5, atualizados: 10, excluidos: 1 },
      periodo_b: { inicio: '2026-08-01', fim: '2026-08-30', total_recursos: 45, custo_total: 1200, criados: 8, atualizados: 12, excluidos: 3 },
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByRole('button', { name: 'Comparativo' }))

    expect(await screen.findByText('Recursos ativos (no fim do período)')).toBeInTheDocument()
    // delta de recursos ativos: 45 - 40 = 5, crescimento (verde/▲)
    expect(screen.getByText(/▲ 5/)).toBeInTheDocument()
    // delta de custo: 1200 - 1000 = 200
    expect(screen.getByText(/▲ R\$ 200,00/)).toBeInTheDocument()
  })

  it('clicar num recurso abre o modal de detalhe com a linha do tempo', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      },
      eventos: [
        { id: 1, subscription_id: 'sub-1', resource_id: 'r1', resource_type: null, resource_group: null, nome: null, acao: 'CRIACAO', autor: 'joao@vivo.com.br', quando: '2026-08-20T10:00:00Z', operation_name: null, correlation_id: null, criado_em: '', autor_nome: null },
      ],
      custo_diario: [{ cost_date: '2026-08-20', custo: 5.5 }],
      custo_resource_group: 123.45,
      resource_group_recursos: 1,
      billing_detalhe: {
        meter_category: 'Virtual Machines', meter_sub_category: 'Virtual Machines Ddsv5 Series',
        meter_name: 'D4ds v5', product_name: 'Virtual Machines Ddsv5 Series - D4ds v5 - BR South',
        sku: 'Standard_D4ds_v5', vcpus: 4, origem: 'direto',
      },
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByText('vm-teste'))

    expect(await screen.findByText('Detalhe do Recurso')).toBeInTheDocument()
    expect(screen.getByText('Linha do tempo (1 evento)')).toBeInTheDocument()
    expect(screen.getAllByText('✚ Criação').length).toBeGreaterThan(0)
    expect(screen.getByText('Standard_D4ds_v5')).toBeInTheDocument()
    expect(screen.getByText(/4 vCPUs/)).toBeInTheDocument()
    expect(azureInventarioApi.getAzureRecursoDetalhe).toHaveBeenCalledWith(
      '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste', 'sub-1',
    )
  })

  it('modal de detalhe busca propriedades reais da Azure sob demanda (Resource Graph)', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      },
      eventos: [], custo_diario: [], custo_resource_group: 0, resource_group_recursos: 0, billing_detalhe: null,
    })
    vi.mocked(azureInventarioApi.getAzureRecursoArmDetalhe).mockResolvedValue({
      id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
      name: 'vm-teste', type: 'microsoft.compute/virtualmachines', resourceGroup: 'rg-1', location: 'brazilsouth',
      sku: null, properties: { hardwareProfile: { vmSize: 'Standard_D4ds_v5' } }, tags: null,
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByText('vm-teste'))
    expect(await screen.findByText('Detalhe do Recurso')).toBeInTheDocument()

    expect(azureInventarioApi.getAzureRecursoArmDetalhe).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '🔎 Ver propriedades completas (Azure)' }))

    expect(await screen.findByText('microsoft.compute/virtualmachines')).toBeInTheDocument()
    expect(screen.getByText(/vmSize/)).toBeInTheDocument()
    expect(azureInventarioApi.getAzureRecursoArmDetalhe).toHaveBeenCalledWith(
      '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste', 'sub-1',
    )
  })

  it('modal de detalhe mostra o SKU típico do RG quando não há billing direto', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/databricks-rg-x/providers/Microsoft.Compute/disks/disco-x',
        resource_type: 'Microsoft.Compute/disks', resource_group: 'databricks-rg-x', nome: 'disco-x',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 0,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/databricks-rg-x/providers/Microsoft.Compute/disks/disco-x',
        resource_type: 'Microsoft.Compute/disks', resource_group: 'databricks-rg-x', nome: 'disco-x',
        criado_por: null, criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 0,
      },
      eventos: [],
      custo_diario: [],
      custo_resource_group: 0,
      resource_group_recursos: 0,
      billing_detalhe: {
        meter_category: 'Storage', meter_sub_category: 'Premium SSD Managed Disks',
        meter_name: 'P10 LRS Disk', product_name: 'Premium SSD Managed Disks - P10 LRS',
        sku: null, vcpus: null, origem: 'rg_mesmo_tipo',
      },
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByText('disco-x'))

    expect(await screen.findByText('P10 LRS Disk')).toBeInTheDocument()
    expect(screen.getByText(/típico deste Resource Group/)).toBeInTheDocument()
  })

  it('modal de detalhe mostra o nome da assinatura (com fallback pro GUID)', async () => {
    vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([
      { subscription_id: 'sub-1', subscription_name: 'Development', periodo_inicio: null, periodo_fim: null, moeda: null },
    ])
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-teste',
        resource_type: 'Microsoft.Compute/virtualMachines', resource_group: 'rg-1', nome: 'vm-teste',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-20T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-20T10:05:00Z', custo_acumulado: 123.45,
      },
      eventos: [],
      custo_diario: [],
      custo_resource_group: 0,
      resource_group_recursos: 0,
      billing_detalhe: null,
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByText('vm-teste'))

    expect(await screen.findByText('Development')).toBeInTheDocument()
    expect(screen.getByText('(sub-1)')).toBeInTheDocument()
  })

  it('modal de detalhe mostra o custo do Resource Group quando o custo direto do recurso é zero', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursosInventario).mockResolvedValue({
      total: 1,
      recursos: [{
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/databricks-rg-dbw-teste/providers/Microsoft.Network/networkInterfaces/nic-efemera',
        resource_type: 'Microsoft.Network/networkInterfaces', resource_group: 'databricks-rg-dbw-teste', nome: 'nic-efemera',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-31T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-31T10:05:00Z', custo_acumulado: 0,
      }],
    })
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockResolvedValue({
      recurso: {
        id: 1, subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/resourceGroups/databricks-rg-dbw-teste/providers/Microsoft.Network/networkInterfaces/nic-efemera',
        resource_type: 'Microsoft.Network/networkInterfaces', resource_group: 'databricks-rg-dbw-teste', nome: 'nic-efemera',
        criado_por: 'joao@vivo.com.br', criado_em: '2026-08-31T10:00:00Z', atualizado_por: null, atualizado_em: null,
        custo_resource_group: 0, criado_por_nome: null, atualizado_por_nome: null, excluido_por_nome: null, excluido_por: null, excluido_em: null, ativo: true, detectado_em: '2026-08-31T10:05:00Z', custo_acumulado: 0,
      },
      eventos: [],
      custo_diario: [],
      custo_resource_group: 2500.75,
      resource_group_recursos: 34,
      billing_detalhe: null,
    })
    const user = userEvent.setup()
    renderWithClient()
    await user.click(await screen.findByText('nic-efemera'))

    expect(await screen.findByText('Detalhe do Recurso')).toBeInTheDocument()
    expect(screen.getByText(/Custo direto zerado, mas o Resource Group/)).toBeInTheDocument()
    expect(screen.getByText('R$ 2.500,75')).toBeInTheDocument()
    expect(screen.getByText(/34 recursos diferentes/)).toBeInTheDocument()
  })
})
